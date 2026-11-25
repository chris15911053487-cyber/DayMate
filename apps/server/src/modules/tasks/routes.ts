import { and, asc, eq, gt, gte, isNotNull, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { addDays, startOfDayUtc, taskInputSchema, taskPatchSchema, zonedToUtc, type Task } from '@daymate/shared'
import { z } from 'zod'
import type { Db } from '../../db/client.ts'
import { tasks } from '../../db/schema.ts'
import { HttpError } from '../../lib/http-error.ts'
import { assertId } from '../../lib/ids.ts'
import { parse } from '../../lib/validate.ts'
import { userTimezone } from '../auth/users.ts'
import { syncTaskReminders } from '../reminders/schedule.ts'

type TaskRow = typeof tasks.$inferSelect
const RESTORE_WINDOW_MS = 30 * 86400_000

export function toTask(r: TaskRow): Task {
  return {
    id: r.id,
    title: r.title,
    notes: r.notes,
    dueDate: r.dueDate,
    dueAt: r.dueAt?.toISOString() ?? null,
    priority: r.priority,
    done: !!r.doneAt,
    doneAt: r.doneAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }
}

/** 逾期的在前，然后按截止日期、优先级、创建时间 */
const ORDER = [
  sql`${tasks.dueDate} asc nulls last`,
  sql`${tasks.dueAt} asc nulls last`,
  sql`case ${tasks.priority} when 'high' then 0 when 'normal' then 1 else 2 end`,
  asc(tasks.createdAt),
]

/** 某天要看的待办：没完成的（逾期 + 当天到期 + 没截止日期）和当天完成的 */
export async function tasksForDay(db: Db, userId: string, date: string, tz: string) {
  const dayStart = startOfDayUtc(date, tz)
  const dayEnd = startOfDayUtc(addDays(date, 1), tz)
  const rows = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        or(
          and(isNull(tasks.doneAt), or(isNull(tasks.dueDate), lte(tasks.dueDate, date))),
          and(gte(tasks.doneAt, dayStart), lt(tasks.doneAt, dayEnd)),
        ),
      ),
    )
    .orderBy(...ORDER)
  return rows.map(toTask)
}

function dueColumns(input: { dueDate?: string | null; dueTime?: string | null }, tz: string) {
  const dueDate = input.dueDate ?? null
  if (!dueDate && input.dueTime) throw new HttpError(400, 'VALIDATION', '设了时间就要设日期')
  return { dueDate, dueAt: dueDate && input.dueTime ? zonedToUtc(dueDate, input.dueTime, tz) : null }
}

export async function taskRoutes(app: FastifyInstance) {
  const { db } = app.deps
  app.addHook('preHandler', app.authenticate)
  const uid = (req: { auth?: { userId: string } }) => req.auth!.userId

  async function own(userId: string, id: string, includeDeleted = false) {
    const [r] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, assertId(id, '待办')), eq(tasks.userId, userId), includeDeleted ? undefined : isNull(tasks.deletedAt)))
      .limit(1)
    if (!r) throw new HttpError(404, 'NOT_FOUND', '找不到这条待办')
    return r
  }

  /** status: open（默认）/ done / all */
  app.get('/tasks', async (req) => {
    const { status } = parse(z.object({ status: z.enum(['open', 'done', 'all']).default('open') }), req.query)
    const where: SQL[] = [eq(tasks.userId, uid(req)), isNull(tasks.deletedAt)]
    if (status === 'open') where.push(isNull(tasks.doneAt))
    if (status === 'done') where.push(isNotNull(tasks.doneAt))
    const rows = await db
      .select()
      .from(tasks)
      .where(and(...where))
      .orderBy(...(status === 'done' ? [sql`${tasks.doneAt} desc`] : ORDER))
      .limit(500)
    return rows.map(toTask)
  })

  app.post('/tasks', async (req, reply) => {
    const input = parse(taskInputSchema, req.body)
    const tz = await userTimezone(db, uid(req))
    const [r] = await db
      .insert(tasks)
      .values({
        userId: uid(req),
        title: input.title,
        notes: input.notes || null,
        priority: input.priority ?? 'normal',
        ...dueColumns(input, tz),
      })
      .returning()
    await syncTaskReminders(db, r!.id)
    reply.code(201)
    return toTask(r!)
  })

  app.patch<{ Params: { id: string } }>('/tasks/:id', async (req) => {
    const input = parse(taskPatchSchema, req.body)
    const old = await own(uid(req), req.params.id)
    const set: Partial<TaskRow> = { updatedAt: new Date() }
    if (input.title !== undefined) set.title = input.title
    if (input.notes !== undefined) set.notes = input.notes || null
    if (input.priority !== undefined) set.priority = input.priority
    if (input.dueDate !== undefined || input.dueTime !== undefined) {
      const tz = await userTimezone(db, uid(req))
      Object.assign(set, dueColumns({ dueDate: input.dueDate !== undefined ? input.dueDate : old.dueDate, dueTime: input.dueTime }, tz))
    }
    if (input.done !== undefined) set.doneAt = input.done ? (old.doneAt ?? new Date()) : null
    const [r] = await db.update(tasks).set(set).where(eq(tasks.id, old.id)).returning()
    await syncTaskReminders(db, r!.id)
    return toTask(r!)
  })

  app.delete<{ Params: { id: string } }>('/tasks/:id', async (req, reply) => {
    const r = await own(uid(req), req.params.id)
    await db.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, r.id))
    await syncTaskReminders(db, r.id)
    return reply.code(204).send()
  })

  app.post<{ Params: { id: string } }>('/tasks/:id/restore', async (req) => {
    const r = await own(uid(req), req.params.id, true)
    const [restored] = await db
      .update(tasks)
      .set({ deletedAt: null })
      .where(and(eq(tasks.id, r.id), gt(tasks.deletedAt, new Date(Date.now() - RESTORE_WINDOW_MS))))
      .returning()
    if (!restored) throw new HttpError(400, 'CANNOT_RESTORE', '这条待办已经无法恢复')
    await syncTaskReminders(db, restored.id)
    return toTask(restored)
  })
}
