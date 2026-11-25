import { and, asc, desc, eq, gte, isNotNull, isNull, lt, lte, or, gt } from 'drizzle-orm'
import { addDays, startOfDayUtc, type CalendarColor, type CalendarInfo } from '@daymate/shared'
import type { Db } from '../../db/client.ts'
import { calendars, events } from '../../db/schema.ts'
import { HttpError } from '../../lib/http-error.ts'
import { expandOccurrences } from './occurrences.ts'

export const DEFAULT_CALENDAR_NAME = '我的日历'

const toInfo = (c: typeof calendars.$inferSelect): CalendarInfo => ({ id: c.id, name: c.name, color: c.color, isDefault: c.isDefault })

/** 列出日历本；第一次用时自动建默认的"我的日历" */
export async function listCalendars(db: Db, userId: string): Promise<CalendarInfo[]> {
  const q = () =>
    db
      .select()
      .from(calendars)
      .where(and(eq(calendars.userId, userId), isNull(calendars.deletedAt)))
      .orderBy(desc(calendars.isDefault), asc(calendars.createdAt))
  let rows = await q()
  if (!rows.some((c) => c.isDefault)) {
    await db.insert(calendars).values({ userId, name: DEFAULT_CALENDAR_NAME, color: 'primary', isDefault: true })
    rows = await q()
  }
  return rows.map(toInfo)
}

/** 校验日历本属于当前用户；不传 id 用默认日历本 */
export async function resolveCalendar(db: Db, userId: string, calendarId?: string) {
  const list = await listCalendars(db, userId)
  const cal = calendarId ? list.find((c) => c.id === calendarId) : list.find((c) => c.isDefault)
  if (!cal) throw new HttpError(400, 'CALENDAR_NOT_FOUND', '找不到这个日历本')
  return cal
}

/** [from, to]（用户时区的日期）里的全部日程场次 */
export async function occurrencesInRange(db: Db, userId: string, from: string, to: string, tz: string) {
  const cals = await listCalendars(db, userId)
  const colors = new Map(cals.map((c) => [c.id, c.color]))
  const rangeStart = startOfDayUtc(from, tz)
  const rangeEnd = startOfDayUtc(addDays(to, 1), tz)
  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        isNull(events.deletedAt),
        or(
          // 重复日程：开始得不晚于区间结束，交给展开逻辑判断
          and(isNotNull(events.rrule), or(lt(events.startAt, rangeEnd), lte(events.startDate, to))),
          and(isNull(events.rrule), lt(events.startAt, rangeEnd), gt(events.endAt, rangeStart)),
          and(isNull(events.rrule), lte(events.startDate, to), gte(events.endDate, from)),
        ),
      ),
    )
  // 已删日历本里的日程不显示
  const visible = rows.filter((r) => colors.has(r.calendarId))
  return expandOccurrences(visible, from, to, tz, (id) => colors.get(id) ?? ('primary' as CalendarColor))
}
