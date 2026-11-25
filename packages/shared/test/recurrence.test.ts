import { describe, expect, it } from 'vitest'
import { describeRepeat, expandDates, fromRRule, presetOf, toRRule, type Repeat } from '../src/recurrence.ts'

describe('RRULE 互转', () => {
  it.each<[Repeat, string]>([
    [{ freq: 'daily' }, 'FREQ=DAILY'],
    [{ freq: 'weekly', byWeekday: [5, 1, 3] }, 'FREQ=WEEKLY;BYDAY=MO,WE,FR'],
    [{ freq: 'weekly', byWeekday: [0, 6] }, 'FREQ=WEEKLY;BYDAY=SA,SU'],
    [{ freq: 'monthly', interval: 2, until: '2027-06-30' }, 'FREQ=MONTHLY;INTERVAL=2;UNTIL=20270630'],
    [{ freq: 'yearly', count: 5 }, 'FREQ=YEARLY;COUNT=5'],
  ])('%j ⇄ %s', (r, s) => {
    expect(toRRule(r)).toBe(s)
    expect(toRRule(fromRRule(s)!)).toBe(s)
  })
  it('不认识的规则返回 null', () => expect(fromRRule('FREQ=HOURLY')).toBeNull())
})

describe('展开', () => {
  it('每天，按区间截取', () => {
    expect(expandDates('2026-11-01', { freq: 'daily' }, '2026-11-24', '2026-11-26')).toEqual(['2026-11-24', '2026-11-25', '2026-11-26'])
  })
  it('每 3 天，次数限制从开始算', () => {
    expect(expandDates('2026-11-01', { freq: 'daily', interval: 3, count: 4 }, '2026-11-01', '2026-12-31')).toEqual([
      '2026-11-01', '2026-11-04', '2026-11-07', '2026-11-10',
    ])
  })
  it('每周一 9 点例会：区间内每个周一', () => {
    expect(expandDates('2026-11-02', { freq: 'weekly' }, '2026-11-01', '2026-11-30')).toEqual([
      '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30',
    ])
  })
  it('工作日，不早于开始日期', () => {
    expect(expandDates('2026-11-25', { freq: 'weekly', byWeekday: [1, 2, 3, 4, 5] }, '2026-11-23', '2026-11-30')).toEqual([
      '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-30',
    ])
  })
  it('每 2 周的周二、周四，到截止日期为止', () => {
    expect(expandDates('2026-11-03', { freq: 'weekly', interval: 2, byWeekday: [2, 4], until: '2026-12-03' }, '2026-11-01', '2027-01-31')).toEqual([
      '2026-11-03', '2026-11-05', '2026-11-17', '2026-11-19', '2026-12-01', '2026-12-03',
    ])
  })
  it('开始那天不在所选星期里也算一次', () => {
    expect(expandDates('2026-11-24', { freq: 'weekly', byWeekday: [1] }, '2026-11-01', '2026-12-08')).toEqual([
      '2026-11-24', '2026-11-30', '2026-12-07',
    ])
  })
  it('每月 31 日：没有 31 日的月份跳过', () => {
    expect(expandDates('2026-01-31', { freq: 'monthly' }, '2026-01-01', '2026-06-30')).toEqual(['2026-01-31', '2026-03-31', '2026-05-31'])
  })
  it('每年 2 月 29 日只在闰年', () => {
    expect(expandDates('2024-02-29', { freq: 'yearly' }, '2024-01-01', '2032-12-31')).toEqual(['2024-02-29', '2028-02-29', '2032-02-29'])
  })
  it('远期区间不用从头枚举也正确', () => {
    expect(expandDates('2020-01-06', { freq: 'weekly' }, '2026-11-23', '2026-11-29')).toEqual(['2026-11-23'])
    expect(expandDates('2020-01-15', { freq: 'monthly' }, '2026-11-01', '2026-12-31')).toEqual(['2026-11-15', '2026-12-15'])
  })
})

describe('中文描述与快捷项', () => {
  it.each<[Repeat | null, string, string]>([
    [null, '2026-11-24', '不重复'],
    [{ freq: 'weekly', byWeekday: [1, 2, 3, 4, 5] }, '2026-11-24', '工作日'],
    [{ freq: 'weekly' }, '2026-11-23', '每周一'],
    [{ freq: 'weekly', interval: 2, byWeekday: [3, 1] }, '2026-11-23', '每 2 周一、三'],
    [{ freq: 'monthly', until: '2027-01-31' }, '2026-11-15', '每月 15 日，到 2027-01-31 为止'],
  ])('%j', (r, start, text) => expect(describeRepeat(r, start)).toBe(text))

  it('快捷项识别', () => {
    expect(presetOf({ freq: 'weekly', byWeekday: [5, 4, 3, 2, 1] })).toBe('workdays')
    expect(presetOf({ freq: 'weekly', byWeekday: [1, 3] })).toBe('custom')
    expect(presetOf({ freq: 'daily', interval: 2 })).toBe('custom')
  })
})
