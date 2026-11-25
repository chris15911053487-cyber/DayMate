import { and, desc, eq, ilike, isNull, or } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { dateKeySchema, todayKey, type SearchResult, type TodayData } from '@daymate/shared'
import { z } from 'zod'
import { entries, events, tasks } from '../../db/schema.ts'
import { parse } from '../../lib/validate.ts'
import { userTimezone } from '../auth/users.ts'
import { toEventDetail } from '../calendar/occurrences.ts'
import { occurrencesInRange } from '../calendar/repo.ts'
import { entriesBetween, toEntry } from '../entries/routes.ts'
import { tasksForDay, toTask } from '../tasks/routes.ts'
import { briefsFor } from '../briefs/generate.ts'

/** LIKE 里的 % _ \ 要转义，否则用户输入会被当通配符 */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`

export async function todayRoutes(app: FastifyInstance) {
  const { db } = app.deps
  app.addHook('preHandler', app.authenticate)
  const uid = (req: { auth?: { userId: string } }) => req.auth!.userId

  /** 首页一次取齐：某天（默认用户时区的今天）的日程场次、待办、记录 */
  app.get('/today', async (req): Promise<TodayData> => {
    const tz = await userTimezone(db, uid(req))
    const { date = todayKey(tz) } = parse(z.object({ date: dateKeySchema.optional() }), req.query)
    const [occ, taskList, entryList, briefs] = await Promise.all([
      occurrencesInRange(db, uid(req), date, date, tz),
      tasksForDay(db, uid(req), date, tz),
      entriesBetween(db, uid(req), date, date),
      briefsFor(db, uid(req), date),
    ])
    return { date, timezone: tz, events: occ, tasks: taskList, entries: entryList, briefs }
  })

  /** 关键词搜索日程、待办、记录（P1 数据量小，ILIKE 足够；P2 换全文检索 + 语义检索） */
  app.get('/search', async (req): Promise<SearchResult> => {
    const { q } = parse(z.object({ q: z.string().trim().min(1, '输入要搜的内容').max(50) }), req.query)
    const p = likePattern(q)
    const [ev, tk, en] = await Promise.all([
      db
        .select()
        .from(events)
        .where(and(eq(events.userId, uid(req)), isNull(events.deletedAt), or(ilike(events.title, p), ilike(events.location, p), ilike(events.notes, p))))
        .orderBy(desc(events.updatedAt))
        .limit(20),
      db
        .select()
        .from(tasks)
        .where(and(eq(tasks.userId, uid(req)), isNull(tasks.deletedAt), or(ilike(tasks.title, p), ilike(tasks.notes, p))))
        .orderBy(desc(tasks.updatedAt))
        .limit(20),
      db
        .select()
        .from(entries)
        .where(and(eq(entries.userId, uid(req)), isNull(entries.deletedAt), ilike(entries.content, p)))
        .orderBy(desc(entries.entryDate))
        .limit(20),
    ])
    return { events: ev.map(toEventDetail), tasks: tk.map(toTask), entries: en.map(toEntry) }
  })
}
