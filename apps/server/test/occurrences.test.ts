import { describe, expect, it } from 'vitest'
import { expandOccurrences, inputToColumns, type EventRow } from '../src/modules/calendar/occurrences.ts'

const SH = 'Asia/Shanghai'
let seq = 0
function row(input: Parameters<typeof inputToColumns>[0], tz = SH): EventRow {
  const now = new Date()
  return {
    id: `00000000-0000-7000-8000-${String(++seq).padStart(12, '0')}`,
    userId: 'u',
    calendarId: 'c',
    source: 'manual',
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...inputToColumns(input, tz),
  } as EventRow
}
const expand = (rows: EventRow[], from: string, to: string, tz = SH) => expandOccurrences(rows, from, to, tz, () => 'primary')

describe('输入换算', () => {
  it('没写结束时间默认 1 小时；跨午夜顺到第二天', () => {
    const a = inputToColumns({ title: 'a', allDay: false, startDate: '2026-11-25', startTime: '15:00' }, SH)
    expect(a.startAt!.toISOString()).toBe('2026-11-25T07:00:00.000Z')
    expect(a.endAt!.toISOString()).toBe('2026-11-25T08:00:00.000Z')
    const b = inputToColumns({ title: 'b', allDay: false, startDate: '2026-11-25', startTime: '23:30' }, SH)
    expect(b.endAt!.toISOString()).toBe('2026-11-25T16:30:00.000Z')
  })
  it('重复规则存成 RRULE，提醒去重排序', () => {
    const c = inputToColumns({ title: 'c', allDay: true, startDate: '2026-11-25', repeat: { freq: 'weekly', byWeekday: [1, 3] }, remindBeforeMin: [30, 0, 30] }, SH)
    expect(c).toMatchObject({ rrule: 'FREQ=WEEKLY;BYDAY=MO,WE', remindBeforeMin: [0, 30], startDate: '2026-11-25', endDate: '2026-11-25' })
  })
})

describe('展开', () => {
  const weekly = row({ title: '例会', allDay: false, startDate: '2026-11-02', startTime: '09:00', endTime: '10:00', repeat: { freq: 'weekly' } })

  it('每周一 9 点例会：月视图里每个周一一场，键带日期', () => {
    const occ = expand([weekly], '2026-11-01', '2026-11-30')
    expect(occ.map((o) => o.start)).toEqual([
      '2026-11-02T01:00:00.000Z', '2026-11-09T01:00:00.000Z', '2026-11-16T01:00:00.000Z', '2026-11-23T01:00:00.000Z', '2026-11-30T01:00:00.000Z',
    ])
    expect(occ[0]!.key).toBe(`${weekly.id}:2026-11-02`)
    expect(occ.every((o) => o.recurring)).toBe(true)
  })

  it('用户改成东京时区：同一瞬间，显示为 10 点，仍在周一', () => {
    const occ = expand([weekly], '2026-11-23', '2026-11-23', 'Asia/Tokyo')
    expect(occ).toHaveLength(1)
    expect(occ[0]!.start).toBe('2026-11-23T01:00:00.000Z')
  })

  it('洛杉矶用户看北京周一 9 点的例会：落在周日', () => {
    expect(expand([weekly], '2026-11-22', '2026-11-22', 'America/Los_Angeles')).toHaveLength(1)
    expect(expand([weekly], '2026-11-23', '2026-11-23', 'America/Los_Angeles')).toHaveLength(0)
  })

  it('纽约时区的重复日程跨夏令时：墙上时间保持 9 点', () => {
    const ny = row({ title: 'standup', allDay: false, startDate: '2026-10-26', startTime: '09:00', repeat: { freq: 'weekly' } }, 'America/New_York')
    const occ = expand([ny], '2026-10-26', '2026-11-02', 'America/New_York')
    expect(occ.map((o) => o.start)).toEqual(['2026-10-26T13:00:00.000Z', '2026-11-02T14:00:00.000Z'])
  })

  it('跨天的日程在两天里都出现；全天多日日程按日期覆盖', () => {
    const night = row({ title: '夜班', allDay: false, startDate: '2026-11-24', startTime: '22:00', endDate: '2026-11-25', endTime: '06:00' })
    expect(expand([night], '2026-11-25', '2026-11-25')).toHaveLength(1)
    const trip = row({ title: '出差', allDay: true, startDate: '2026-11-24', endDate: '2026-11-26' })
    expect(expand([trip], '2026-11-26', '2026-11-30')).toHaveLength(1)
    expect(expand([trip], '2026-11-27', '2026-11-30')).toHaveLength(0)
  })

  it('全天重复的多日日程：前一场延续进区间也算', () => {
    const weekend = row({ title: '周末', allDay: true, startDate: '2026-11-21', endDate: '2026-11-22', repeat: { freq: 'weekly' } })
    const occ = expand([weekend], '2026-11-22', '2026-11-28')
    expect(occ.map((o) => o.startDate)).toEqual(['2026-11-21', '2026-11-28'])
  })

  it('排序：全天在前，其余按开始时间', () => {
    const a = row({ title: '下午', allDay: false, startDate: '2026-11-25', startTime: '15:00' })
    const b = row({ title: '全天', allDay: true, startDate: '2026-11-25' })
    const c = row({ title: '上午', allDay: false, startDate: '2026-11-25', startTime: '09:00' })
    expect(expand([a, b, c], '2026-11-25', '2026-11-25').map((o) => o.title)).toEqual(['全天', '上午', '下午'])
  })
})
