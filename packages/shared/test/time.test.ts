import { describe, expect, it } from 'vitest'
import {
  addDays, addMonths, diffDays, isDateKey, relativeDayLabel, startOfWeek, todayKey, weekday, zonedParts, zonedToUtc,
} from '../src/time.ts'

describe('日期键运算', () => {
  it('加减天数跨月跨年、闰年', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29')
    expect(diffDays('2026-11-24', '2026-12-01')).toBe(7)
  })
  it('星期、周一开始的周', () => {
    expect(weekday('2026-11-24')).toBe(2)
    expect(startOfWeek('2026-11-24')).toBe('2026-11-23')
    expect(startOfWeek('2026-11-29')).toBe('2026-11-23')
  })
  it('加月份：月底对齐', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-11-15', -12)).toBe('2025-11-15')
  })
  it('校验日期键', () => {
    expect(isDateKey('2026-02-29')).toBe(false)
    expect(isDateKey('2028-02-29')).toBe(true)
    expect(isDateKey('2026-1-1')).toBe(false)
  })
  it('相对叫法', () => {
    expect(relativeDayLabel('2026-11-25', '2026-11-24')).toBe('明天')
    expect(relativeDayLabel('2026-11-30', '2026-11-24')).toBe('11月30日 周一')
    expect(relativeDayLabel('2027-01-02', '2026-11-24')).toBe('2027年1月2日')
  })
})

describe('时区换算', () => {
  it('北京时间 15:00 = UTC 07:00；东京显示 16:00', () => {
    const t = zonedToUtc('2026-11-25', '15:00', 'Asia/Shanghai')
    expect(t.toISOString()).toBe('2026-11-25T07:00:00.000Z')
    expect(zonedParts(t, 'Asia/Tokyo')).toMatchObject({ date: '2026-11-25', time: '16:00' })
    expect(zonedParts(t, 'America/Los_Angeles')).toMatchObject({ date: '2026-11-24', time: '23:00' })
  })
  it('夏令时：纽约 3 月跳过的 02:30 顺延，11 月重复的 01:30 取第一个', () => {
    expect(zonedToUtc('2026-03-08', '02:30', 'America/New_York').toISOString()).toBe('2026-03-08T07:30:00.000Z')
    expect(zonedToUtc('2026-03-08', '09:00', 'America/New_York').toISOString()).toBe('2026-03-08T13:00:00.000Z')
    expect(zonedToUtc('2026-11-01', '01:30', 'America/New_York').toISOString()).toBe('2026-11-01T05:30:00.000Z')
  })
  it('今天按用户时区算', () => {
    const t = Date.parse('2026-11-24T17:00:00Z')
    expect(todayKey('Asia/Shanghai', t)).toBe('2026-11-25')
    expect(todayKey('Europe/London', t)).toBe('2026-11-24')
  })
})
