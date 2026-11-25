import { and, eq, inArray, isNull } from 'drizzle-orm'
import { addDays, zonedParts, zonedToUtc } from '@daymate/shared'
import type { Db } from '../../db/client.ts'
import { events, reminders, tasks } from '../../db/schema.ts'
import { expandOccurrences, type EventRow } from '../calendar/occurrences.ts'

/** 全天日程按当天早上 9 点（日程时区）算提醒的基准时间 */
const ALL_DAY_ANCHOR = '09:00'
/** 最多往后找这么多天的下一场 */
const LOOKAHEAD_DAYS = 400

/** 晚于 after 的场次开始时间（按时间排序，最多 limit 个） */
export function upcomingStarts(ev: EventRow, after: Date, limit = 3): Date[] {
  if (!ev.rrule) {
    const start = ev.allDay ? zonedToUtc(ev.startDate!, ALL_DAY_ANCHOR, ev.timezone) : ev.startAt!
    return start > after ? [start] : []
  }
  const from = addDays(zonedParts(after, ev.timezone).date, -1)
  const occ = expandOccurrences([ev], from, addDays(from, LOOKAHEAD_DAYS), ev.timezone, () => 'primary')
  const out: Date[] = []
  for (const o of occ) {
    const start = o.allDay ? zonedToUtc(o.startDate!, ALL_DAY_ANCHOR, ev.timezone) : new Date(o.start!)
    if (start > after) out.push(start)
    if (out.length >= limit) break
  }
  return out
}

/**
 * 按日程当前的提醒设置重排：删掉还没发的，每个提前量排下一场（已经提醒过的那场跳过）。
 * 开始前才建的日程（提醒时间已过、但还没开始）立即提醒。
 */
export async function syncEventReminders(db: Db, eventId: string, now = new Date()) {
  const [ev] = await db.select().from(events).where(eq(events.id, eventId)).limit(1)
  await db.delete(reminders).where(and(eq(reminders.eventId, eventId), eq(reminders.status, 'pending')))
  if (!ev || ev.deletedAt || !ev.remindBeforeMin.length) return

  const done = await db
    .select({ start: reminders.occurrenceStart, min: reminders.remindMin })
    .from(reminders)
    .where(eq(reminders.eventId, eventId))
  const already = new Set(done.map((d) => `${d.start.getTime()}:${d.min}`))
  const starts = upcomingStarts(ev, now, 3)

  const rows = ev.remindBeforeMin.flatMap((min) => {
    const start = starts.find((s) => !already.has(`${s.getTime()}:${min}`))
    if (!start) return []
    const fireAt = new Date(Math.max(start.getTime() - min * 60_000, now.getTime()))
    return [{ userId: ev.userId, eventId: ev.id, occurrenceStart: start, remindMin: min, fireAt }]
  })
  if (rows.length) await db.insert(reminders).values(rows).onConflictDoNothing()
}

/** 待办：有具体截止时间的，到点提醒一次（只有日期的放在早报里说） */
export async function syncTaskReminders(db: Db, taskId: string, now = new Date()) {
  const [t] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  await db.delete(reminders).where(and(eq(reminders.taskId, taskId), eq(reminders.status, 'pending')))
  if (!t || t.deletedAt || t.doneAt || !t.dueAt || t.dueAt <= now) return
  await db
    .insert(reminders)
    .values({ userId: t.userId, taskId: t.id, occurrenceStart: t.dueAt, remindMin: 0, fireAt: t.dueAt })
    .onConflictDoNothing()
}

/** 删除日历本时，里面日程的待发提醒一起撤掉 */
export async function cancelCalendarReminders(db: Db, calendarId: string) {
  const ids = (await db.select({ id: events.id }).from(events).where(and(eq(events.calendarId, calendarId), isNull(events.deletedAt)))).map((r) => r.id)
  if (ids.length) await db.delete(reminders).where(and(inArray(reminders.eventId, ids), eq(reminders.status, 'pending')))
}
