import { addDays, startOfDayUtc, todayKey, zonedParts, type DateKey, type Occurrence } from '@daymate/shared'
import { useAuth } from '../auth/store'

const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'

/** 显示一律按用户在"我的"里设的时区，而不是手机/电脑当前的时区 */
export function useTz(): string {
  return useAuth().user?.timezone ?? browserTz()
}

export function useToday(): DateKey {
  return todayKey(useTz())
}

export const timeIn = (iso: string, tz: string) => zonedParts(iso, tz).time
export const dateIn = (iso: string, tz: string) => zonedParts(iso, tz).date

/** 这一场是否落在某天（用户时区） */
export function occursOn(o: Occurrence, day: DateKey, tz: string): boolean {
  if (o.allDay) return o.startDate! <= day && o.endDate! >= day
  const s = Date.parse(o.start!)
  const e = Date.parse(o.end!)
  return s < startOfDayUtc(addDays(day, 1), tz).getTime() && e > startOfDayUtc(day, tz).getTime()
}

/** 列表里显示的时间：全天 / 15:00–16:00 / 跨天的显示日期 */
export function occurrenceTimeLabel(o: Occurrence, day: DateKey, tz: string): string {
  if (o.allDay) return o.startDate === o.endDate ? '全天' : `全天 · ${o.startDate!.slice(5)} 至 ${o.endDate!.slice(5)}`
  const s = zonedParts(o.start!, tz)
  const e = zonedParts(o.end!, tz)
  const startText = s.date === day ? s.time : `${s.date.slice(5)} ${s.time}`
  const endText = e.date === day || (e.date === addDays(day, 1) && e.time === '00:00') ? e.time : `${e.date.slice(5)} ${e.time}`
  return `${startText}–${endText}`
}

/** 某天里的分钟区间（截到当天 0–1440） */
export function minutesWithinDay(o: Occurrence, day: DateKey, tz: string) {
  const dayStart = startOfDayUtc(day, tz).getTime()
  const dayEnd = startOfDayUtc(addDays(day, 1), tz).getTime()
  const s = Math.max(Date.parse(o.start!), dayStart)
  const e = Math.min(Date.parse(o.end!), dayEnd)
  const span = dayEnd - dayStart // 夏令时那天不是 24 小时，按比例换算
  return { top: ((s - dayStart) / span) * 1440, bottom: ((e - dayStart) / span) * 1440 }
}

export interface Placed<T> {
  item: T
  top: number
  bottom: number
  lane: number
  lanes: number
}

/** 时间轴排版：互相重叠的一组并排显示，每组按需要的列数平分宽度 */
export function layoutLanes<T>(items: { item: T; top: number; bottom: number }[], minHeight = 20): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.top - b.top || b.bottom - a.bottom)
  const out: Placed<T>[] = []
  let group: Placed<T>[] = []
  let groupEnd = -1
  const flush = () => {
    const lanes = Math.max(1, ...group.map((p) => p.lane + 1))
    group.forEach((p) => (p.lanes = lanes))
    out.push(...group)
    group = []
  }
  for (const it of sorted) {
    const bottom = Math.max(it.bottom, it.top + minHeight)
    if (it.top >= groupEnd && group.length) flush()
    const laneEnds: number[] = []
    for (const p of group) laneEnds[p.lane] = Math.max(laneEnds[p.lane] ?? -1, p.bottom)
    let lane = laneEnds.findIndex((end) => end <= it.top)
    if (lane < 0) lane = laneEnds.length
    group.push({ item: it.item, top: it.top, bottom, lane, lanes: 1 })
    groupEnd = Math.max(groupEnd, bottom)
  }
  if (group.length) flush()
  return out
}
