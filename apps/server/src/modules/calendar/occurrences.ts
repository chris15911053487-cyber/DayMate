import {
  addDays,
  diffDays,
  expandDates,
  fromRRule,
  minutesOf,
  startOfDayUtc,
  timeOfMinutes,
  toRRule,
  zonedParts,
  zonedToUtc,
  type CalendarColor,
  type EventDetail,
  type EventInput,
  type Occurrence,
} from '@daymate/shared'
import type { events } from '../../db/schema.ts'

export type EventRow = typeof events.$inferSelect
const DEFAULT_DURATION_MIN = 60

/** 表单输入（用户时区的墙上时间）→ 要存的列 */
export function inputToColumns(input: EventInput, tz: string) {
  const endDate = input.endDate ?? input.startDate
  const base = {
    title: input.title.trim(),
    notes: input.notes?.trim() || null,
    location: input.location?.trim() || null,
    people: input.people ?? [],
    allDay: input.allDay,
    timezone: tz,
    rrule: input.repeat ? toRRule(input.repeat) : null,
    remindBeforeMin: [...new Set(input.remindBeforeMin ?? [])].sort((a, b) => a - b),
  }
  if (input.allDay) {
    return { ...base, startDate: input.startDate, endDate, startAt: null, endAt: null }
  }
  const startTime = input.startTime!
  const startAt = zonedToUtc(input.startDate, startTime, tz)
  const endAt = input.endTime
    ? zonedToUtc(endDate, input.endTime, tz)
    : zonedToUtc(input.startDate, timeOfMinutes(minutesOf(startTime) + DEFAULT_DURATION_MIN), tz)
  // 只给了开始时间且跨过午夜（如 23:30 开始）：结束时间落到第二天
  const fixedEnd = endAt <= startAt ? new Date(startAt.getTime() + DEFAULT_DURATION_MIN * 60_000) : endAt
  return { ...base, startAt, endAt: fixedEnd, startDate: null, endDate: null }
}

export function toEventDetail(r: EventRow): EventDetail {
  return {
    id: r.id,
    calendarId: r.calendarId,
    title: r.title,
    notes: r.notes,
    location: r.location,
    people: r.people,
    allDay: r.allDay,
    start: r.startAt?.toISOString() ?? null,
    end: r.endAt?.toISOString() ?? null,
    startDate: r.startDate,
    endDate: r.endDate,
    timezone: r.timezone,
    repeat: r.rrule ? fromRRule(r.rrule) : null,
    remindBeforeMin: r.remindBeforeMin,
    source: r.source,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }
}

/**
 * 把日程展开成 [from, to]（用户时区的日期，含两端）里的每一场。
 * 带时间的重复日程按日程自己的时区展开墙上时间，再按瞬间判断是否落在用户的这几天里。
 */
export function expandOccurrences(
  rows: EventRow[],
  from: string,
  to: string,
  userTz: string,
  colorOf: (calendarId: string) => CalendarColor,
): Occurrence[] {
  const rangeStart = startOfDayUtc(from, userTz).getTime()
  const rangeEnd = startOfDayUtc(addDays(to, 1), userTz).getTime()
  const out: Occurrence[] = []

  for (const r of rows) {
    const repeat = r.rrule ? fromRRule(r.rrule) : null
    const common = {
      eventId: r.id,
      calendarId: r.calendarId,
      color: colorOf(r.calendarId),
      title: r.title,
      location: r.location,
      allDay: r.allDay,
      recurring: !!repeat,
    }

    if (r.allDay) {
      const span = diffDays(r.startDate!, r.endDate!)
      const dates = repeat ? expandDates(r.startDate!, repeat, addDays(from, -span), to) : [r.startDate!]
      for (const d of dates) {
        const end = addDays(d, span)
        if (d > to || end < from) continue
        out.push({ ...common, key: repeat ? `${r.id}:${d}` : r.id, start: null, end: null, startDate: d, endDate: end })
      }
      continue
    }

    const startAt = r.startAt!.getTime()
    const duration = r.endAt!.getTime() - startAt
    if (!repeat) {
      if (startAt < rangeEnd && startAt + duration > rangeStart) {
        out.push({ ...common, key: r.id, start: r.startAt!.toISOString(), end: r.endAt!.toISOString(), startDate: null, endDate: null })
      }
      continue
    }
    const local = zonedParts(startAt, r.timezone)
    const spanDays = Math.ceil(duration / 86400_000) + 1
    const evFrom = addDays(zonedParts(rangeStart, r.timezone).date, -spanDays)
    const evTo = zonedParts(rangeEnd, r.timezone).date
    for (const d of expandDates(local.date, repeat, evFrom, evTo)) {
      const s = zonedToUtc(d, local.time, r.timezone).getTime()
      if (s < rangeEnd && s + duration > rangeStart) {
        out.push({ ...common, key: `${r.id}:${d}`, start: new Date(s).toISOString(), end: new Date(s + duration).toISOString(), startDate: null, endDate: null })
      }
    }
  }

  // 全天的排前面，其余按开始时间
  const sortKey = (o: Occurrence) => (o.allDay ? `0${o.startDate}` : `1${o.start}`)
  return out.sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || a.title.localeCompare(b.title))
}
