import { and, asc, desc, eq, gt, gte, isNull, lte, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { dateKeySchema, diffDays, entryInputSchema, entryPatchSchema, extractTags, zonedParts, zonedToUtc, type Entry } from '@daymate/shared'
import { z } from 'zod'
import type { Db } from '../../db/client.ts'
import { entries, events } from '../../db/schema.ts'
import { HttpError } from '../../lib/http-error.ts'
import { assertId } from '../../lib/ids.ts'
import { parse } from '../../lib/validate.ts'
import { userTimezone } from '../auth/users.ts'

type EntryRow = typeof entries.$inferSelect
const RESTORE_WINDOW_MS = 30 * 86400_000

export function toEntry(r: EntryRow): Entry {
  return {
    id: r.id,
    date: r.entryDate,
    occurredAt: r.occurredAt?.toISOString() ?? null,
    content: r.content,
    tags: r.tags,
    mood: r.mood,
    eventId: r.eventId,
    source: r.source,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }
}

/** 按发生时间排；没写时间的按记下的时间 */
const ORDER = [asc(sql`coalesce(${entries.occurredAt}, ${entries.createdAt})`)]

export async function entriesBetween(db: Db, userId: string, from: string, to: string) {
  const rows = await db
    .select()
    .from(entries)
    .where(and(eq(entries.userId, userId), isNull(entries.deletedAt), gte(entries.entryDate, from), lte(entries.entryDate, to)))
    .orderBy(asc(entries.entryDate), ...ORDER)
  return rows.map(toEntry)
}

export async function entryRoutes(app: FastifyInstance) {
  const { db } = app.deps
  app.addHook('preHandler', app.authenticate)
  const uid = (req: { auth?: { userId: string } }) => req.auth!.userId

  async function own(userId: string, id: string, includeDeleted = false) {
    const [r] = await db
      .select()
      .from(entries)
      .where(and(eq(entries.id, assertId(id, '记录')), eq(entries.userId, userId), includeDeleted ? undefined : isNull(entries.deletedAt)))
      .limit(1)
    if (!r) throw new HttpError(404, 'NOT_FOUND', '找不到这条记录')
    return r
  }

  async function checkEvent(userId: string, eventId: string | null | undefined) {
    if (!eventId) return
    const [e] = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.userId, userId), isNull(events.deletedAt)))
      .limit(1)
    if (!e) throw new HttpError(400, 'EVENT_NOT_FOUND', '关联的日程不存在')
  }

  /** ?date= 某一天，或 ?from=&to= 一段（最多 93 天） */
  app.get('/entries', async (req) => {
    const q = parse(z.object({ date: dateKeySchema.optional(), from: dateKeySchema.optional(), to: dateKeySchema.optional() }), req.query)
    const from = q.date ?? q.from
    const to = q.date ?? q.to
    if (!from || !to) {
      // 不带日期：最近 50 条
      const rows = await db
        .select()
        .from(entries)
        .where(and(eq(entries.userId, uid(req)), isNull(entries.deletedAt)))
        .orderBy(desc(entries.entryDate), desc(sql`coalesce(${entries.occurredAt}, ${entries.createdAt})`))
        .limit(50)
      return rows.map(toEntry)
    }
    if (to < from || diffDays(from, to) > 93) throw new HttpError(400, 'VALIDATION', '一次最多查 93 天')
    return entriesBetween(db, uid(req), from, to)
  })

  app.post('/entries', async (req, reply) => {
    const input = parse(entryInputSchema, req.body)
    await checkEvent(uid(req), input.eventId)
    const tz = await userTimezone(db, uid(req))
    const [r] = await db
      .insert(entries)
      .values({
        userId: uid(req),
        entryDate: input.date,
        occurredAt: input.time ? zonedToUtc(input.date, input.time, tz) : null,
        content: input.content,
        tags: extractTags(input.content),
        mood: input.mood ?? null,
        eventId: input.eventId ?? null,
      })
      .returning()
    reply.code(201)
    return toEntry(r!)
  })

  app.patch<{ Params: { id: string } }>('/entries/:id', async (req) => {
    const input = parse(entryPatchSchema, req.body)
    const old = await own(uid(req), req.params.id)
    if (input.eventId !== undefined) await checkEvent(uid(req), input.eventId)
    const set: Partial<EntryRow> = { updatedAt: new Date() }
    if (input.content !== undefined) {
      set.content = input.content
      set.tags = extractTags(input.content)
    }
    if (input.mood !== undefined) set.mood = input.mood
    if (input.eventId !== undefined) set.eventId = input.eventId
    if (input.date !== undefined || input.time !== undefined) {
      const tz = await userTimezone(db, uid(req))
      const date = input.date ?? old.entryDate
      const time = input.time !== undefined ? input.time : old.occurredAt ? zonedParts(old.occurredAt, tz).time : null
      set.entryDate = date
      set.occurredAt = time ? zonedToUtc(date, time, tz) : null
    }
    const [r] = await db.update(entries).set(set).where(eq(entries.id, old.id)).returning()
    return toEntry(r!)
  })

  app.delete<{ Params: { id: string } }>('/entries/:id', async (req, reply) => {
    const r = await own(uid(req), req.params.id)
    await db.update(entries).set({ deletedAt: new Date() }).where(eq(entries.id, r.id))
    return reply.code(204).send()
  })

  app.post<{ Params: { id: string } }>('/entries/:id/restore', async (req) => {
    const r = await own(uid(req), req.params.id, true)
    const [restored] = await db
      .update(entries)
      .set({ deletedAt: null })
      .where(and(eq(entries.id, r.id), gt(entries.deletedAt, new Date(Date.now() - RESTORE_WINDOW_MS))))
      .returning()
    if (!restored) throw new HttpError(400, 'CANNOT_RESTORE', '这条记录已经无法恢复')
    return toEntry(restored)
  })
}
