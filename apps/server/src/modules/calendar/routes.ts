import { and, eq, gt, isNotNull, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { calendarInputSchema, dateKeySchema, diffDays, eventInputSchema, type EventDetail } from '@daymate/shared'
import { z } from 'zod'
import { calendars, events } from '../../db/schema.ts'
import { HttpError } from '../../lib/http-error.ts'
import { assertId } from '../../lib/ids.ts'
import { parse } from '../../lib/validate.ts'
import { userTimezone } from '../auth/users.ts'
import { inputToColumns, toEventDetail } from './occurrences.ts'
import { listCalendars, occurrencesInRange, resolveCalendar } from './repo.ts'
import { cancelCalendarReminders, syncEventReminders } from '../reminders/schedule.ts'

const RANGE_MAX_DAYS = 93
const RESTORE_WINDOW_MS = 30 * 86400_000
const rangeSchema = z.object({ from: dateKeySchema, to: dateKeySchema })

export async function calendarRoutes(app: FastifyInstance) {
  const { db } = app.deps
  app.addHook('preHandler', app.authenticate)
  const uid = (req: { auth?: { userId: string } }) => req.auth!.userId

  // ---- 日历本 ----
  app.get('/calendars', async (req) => listCalendars(db, uid(req)))

  app.post('/calendars', async (req, reply) => {
    const input = parse(calendarInputSchema, req.body)
    const existing = await listCalendars(db, uid(req))
    if (existing.length >= 20) throw new HttpError(400, 'TOO_MANY', '日历本最多 20 个')
    const [c] = await db.insert(calendars).values({ userId: uid(req), ...input }).returning()
    reply.code(201)
    return { id: c!.id, name: c!.name, color: c!.color, isDefault: c!.isDefault }
  })

  app.patch<{ Params: { id: string } }>('/calendars/:id', async (req) => {
    const input = parse(calendarInputSchema.partial(), req.body)
    const [c] = await db
      .update(calendars)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(calendars.id, assertId(req.params.id, '日历本')), eq(calendars.userId, uid(req)), isNull(calendars.deletedAt)))
      .returning()
    if (!c) throw new HttpError(404, 'NOT_FOUND', '找不到这个日历本')
    return { id: c.id, name: c.name, color: c.color, isDefault: c.isDefault }
  })

  /** 删除日历本连同里面的日程（默认日历本不能删） */
  app.delete<{ Params: { id: string } }>('/calendars/:id', async (req, reply) => {
    const id = assertId(req.params.id, '日历本')
    const cal = await resolveCalendar(db, uid(req), id).catch(() => null)
    if (!cal) throw new HttpError(404, 'NOT_FOUND', '找不到这个日历本')
    if (cal.isDefault) throw new HttpError(400, 'DEFAULT_CALENDAR', '默认日历本不能删除')
    const now = new Date()
    await cancelCalendarReminders(db, id)
    await db.transaction(async (tx) => {
      await tx.update(calendars).set({ deletedAt: now }).where(eq(calendars.id, id))
      await tx.update(events).set({ deletedAt: now }).where(and(eq(events.calendarId, id), isNull(events.deletedAt)))
    })
    return reply.code(204).send()
  })

  // ---- 日程 ----
  /** 某段日期（用户时区，含两端）里的日程场次，重复日程已展开 */
  app.get('/events', async (req) => {
    const { from, to } = parse(rangeSchema, req.query)
    if (to < from || diffDays(from, to) > RANGE_MAX_DAYS) throw new HttpError(400, 'VALIDATION', `一次最多查 ${RANGE_MAX_DAYS} 天`)
    return occurrencesInRange(db, uid(req), from, to, await userTimezone(db, uid(req)))
  })

  async function ownEvent(userId: string, id: string, includeDeleted = false) {
    const [r] = await db
      .select()
      .from(events)
      .where(and(eq(events.id, assertId(id, '日程')), eq(events.userId, userId), includeDeleted ? undefined : isNull(events.deletedAt)))
      .limit(1)
    if (!r) throw new HttpError(404, 'NOT_FOUND', '找不到这条日程')
    return r
  }

  app.post('/events', async (req, reply): Promise<EventDetail> => {
    const input = parse(eventInputSchema, req.body)
    const cal = await resolveCalendar(db, uid(req), input.calendarId)
    const tz = await userTimezone(db, uid(req))
    const [r] = await db
      .insert(events)
      .values({ userId: uid(req), calendarId: cal.id, ...inputToColumns(input, tz) })
      .returning()
    await syncEventReminders(db, r!.id)
    reply.code(201)
    return toEventDetail(r!)
  })

  app.get<{ Params: { id: string } }>('/events/:id', async (req) => toEventDetail(await ownEvent(uid(req), req.params.id)))

  /** 整体替换（编辑表单提交完整内容）；重复日程改的是整个系列 */
  app.put<{ Params: { id: string } }>('/events/:id', async (req): Promise<EventDetail> => {
    const input = parse(eventInputSchema, req.body)
    const old = await ownEvent(uid(req), req.params.id)
    const cal = await resolveCalendar(db, uid(req), input.calendarId ?? old.calendarId)
    // 表单里的时间是按用户当前时区显示和填写的，所以按当前时区换算回去
    const tz = await userTimezone(db, uid(req))
    const [r] = await db
      .update(events)
      .set({ calendarId: cal.id, ...inputToColumns(input, tz), updatedAt: new Date() })
      .where(eq(events.id, old.id))
      .returning()
    await syncEventReminders(db, r!.id)
    return toEventDetail(r!)
  })

  app.delete<{ Params: { id: string } }>('/events/:id', async (req, reply) => {
    const r = await ownEvent(uid(req), req.params.id)
    await db.update(events).set({ deletedAt: new Date() }).where(eq(events.id, r.id))
    await syncEventReminders(db, r.id)
    return reply.code(204).send()
  })

  app.post<{ Params: { id: string } }>('/events/:id/restore', async (req) => {
    const r = await ownEvent(uid(req), req.params.id, true)
    const [restored] = await db
      .update(events)
      .set({ deletedAt: null })
      .where(and(eq(events.id, r.id), isNotNull(events.deletedAt), gt(events.deletedAt, new Date(Date.now() - RESTORE_WINDOW_MS))))
      .returning()
    if (!restored) throw new HttpError(400, 'CANNOT_RESTORE', '这条日程已经无法恢复')
    await syncEventReminders(db, restored.id)
    return toEventDetail(restored)
  })
}
