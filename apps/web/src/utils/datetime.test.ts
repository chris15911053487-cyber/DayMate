import { describe, expect, it } from 'vitest'
import type { Occurrence } from '@daymate/shared'
import { layoutLanes, minutesWithinDay, occurrenceTimeLabel, occursOn } from './datetime'

const occ = (start: string, end: string): Occurrence => ({
  key: start, eventId: 'e', calendarId: 'c', color: 'primary', title: 't', location: null, allDay: false,
  start, end, startDate: null, endDate: null, recurring: false,
})
const SH = 'Asia/Shanghai'

describe('时间工具', () => {
  it('跨午夜的日程两天都算，标签显示日期', () => {
    const night = occ('2026-11-24T14:00:00Z', '2026-11-24T22:00:00Z') // 北京 22:00–次日 06:00
    expect(occursOn(night, '2026-11-24', SH)).toBe(true)
    expect(occursOn(night, '2026-11-25', SH)).toBe(true)
    expect(occursOn(night, '2026-11-26', SH)).toBe(false)
    expect(occurrenceTimeLabel(night, '2026-11-24', SH)).toBe('22:00–11-25 06:00')
    expect(minutesWithinDay(night, '2026-11-25', SH)).toEqual({ top: 0, bottom: 360 })
  })
  it('到第二天 0 点结束的不显示日期', () => {
    expect(occurrenceTimeLabel(occ('2026-11-24T15:00:00Z', '2026-11-24T16:00:00Z'), '2026-11-24', SH)).toBe('23:00–00:00')
  })
})

describe('并排排版', () => {
  it('不重叠的各占整行；重叠的平分；第三个可以复用空出来的列', () => {
    const r = layoutLanes([
      { item: 'a', top: 540, bottom: 600 },
      { item: 'b', top: 570, bottom: 660 },
      { item: 'c', top: 610, bottom: 640 },
      { item: 'd', top: 700, bottom: 760 },
    ])
    const by = Object.fromEntries(r.map((p) => [p.item, [p.lane, p.lanes]]))
    expect(by).toEqual({ a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] })
  })
})
