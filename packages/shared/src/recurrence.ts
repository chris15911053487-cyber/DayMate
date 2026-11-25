import { addDays, daysInMonth, diffDays, makeKey, splitKey, startOfWeek, weekday, type DateKey } from './time.ts'

/**
 * 重复规则：存成 RRULE（RFC 5545 的子集）。P1 支持每天 / 每周（可选星期几，含"工作日"）/ 每月 / 每年，
 * 可设间隔、截止日期或次数。展开按"墙上日期"算，与时区无关（时区在调用方处理）。
 */
export type RepeatFreq = 'daily' | 'weekly' | 'monthly' | 'yearly'
export interface Repeat {
  freq: RepeatFreq
  /** 每隔几个周期，默认 1 */
  interval?: number
  /** 每周的星期几：0=周日 … 6=周六；不填 = 开始那天的星期 */
  byWeekday?: number[]
  /** 截止日期（含当天） */
  until?: DateKey | null
  /** 总次数 */
  count?: number | null
}

const RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const FREQ_TO_RRULE: Record<RepeatFreq, string> = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' }

export function toRRule(r: Repeat): string {
  const parts = [`FREQ=${FREQ_TO_RRULE[r.freq]}`]
  if (r.interval && r.interval > 1) parts.push(`INTERVAL=${r.interval}`)
  if (r.freq === 'weekly' && r.byWeekday?.length) {
    parts.push(`BYDAY=${[...new Set(r.byWeekday)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => RRULE_DAYS[d]).join(',')}`)
  }
  if (r.until) parts.push(`UNTIL=${r.until.replaceAll('-', '')}`)
  else if (r.count) parts.push(`COUNT=${r.count}`)
  return parts.join(';')
}

export function fromRRule(s: string): Repeat | null {
  const map = new Map(
    s
      .replace(/^RRULE:/, '')
      .split(';')
      .map((kv) => kv.split('=') as [string, string]),
  )
  const freq = Object.entries(FREQ_TO_RRULE).find(([, v]) => v === map.get('FREQ'))?.[0] as RepeatFreq | undefined
  if (!freq) return null
  const r: Repeat = { freq }
  const interval = Number(map.get('INTERVAL'))
  if (interval > 1) r.interval = interval
  const byday = map.get('BYDAY')
  if (byday) r.byWeekday = byday.split(',').map((d) => RRULE_DAYS.indexOf(d)).filter((d) => d >= 0)
  const until = map.get('UNTIL')
  if (until && /^\d{8}/.test(until)) r.until = `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`
  const count = Number(map.get('COUNT'))
  if (count > 0) r.count = count
  return r
}

/** 防止异常规则把服务器拖死：最多枚举这么多个周期 */
const MAX_PERIODS = 20_000

/**
 * 从 start 开始按规则展开，返回落在 [from, to] 内的日期（含两端）。
 * 第一次一定是 start 本身（即使不符合 byWeekday，与主流日历一致：开始那天总算一次）。
 */
export function expandDates(start: DateKey, r: Repeat, from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = []
  const interval = Math.max(1, r.interval ?? 1)
  const until = r.until && r.until < to ? r.until : to
  let n = 0
  const emit = (key: DateKey) => {
    if (key < start) return true
    if (r.count && n >= r.count) return false
    if (key > until) return false
    n++
    if (key >= from) out.push(key)
    return true
  }

  if (r.freq === 'daily') {
    // 没有次数限制时直接跳到区间附近
    let i = r.count ? 0 : Math.max(0, Math.floor(diffDays(start, from) / interval))
    for (let k = 0; k < MAX_PERIODS; k++, i++) if (!emit(addDays(start, i * interval))) break
    return out
  }

  if (r.freq === 'weekly') {
    const days = (r.byWeekday?.length ? [...new Set(r.byWeekday)] : [weekday(start)]).map((d) => (d + 6) % 7).sort((a, b) => a - b)
    const week0 = startOfWeek(start)
    if (!days.includes((weekday(start) + 6) % 7)) emit(start)
    let w = r.count ? 0 : Math.max(0, Math.floor(diffDays(week0, startOfWeek(from)) / 7 / interval))
    for (let k = 0; k < MAX_PERIODS; k++, w++) {
      const monday = addDays(week0, w * 7 * interval)
      if (monday > until) break
      let stop = false
      for (const d of days) if (!emit(addDays(monday, d))) stop = true
      if (stop) break
    }
    return out
  }

  // 每月 / 每年：没有这一天的月份（31 号、2 月 29 日）跳过
  const { year, month, day } = splitKey(start)
  const stepMonths = r.freq === 'monthly' ? interval : interval * 12
  let i = 0
  if (!r.count) {
    const { year: fy, month: fm } = splitKey(from)
    const monthsBetween = (fy - year) * 12 + (fm - month)
    i = Math.max(0, Math.floor(monthsBetween / stepMonths) - 1)
  }
  for (let k = 0; k < MAX_PERIODS; k++, i++) {
    const total = year * 12 + (month - 1) + i * stepMonths
    const y = Math.floor(total / 12)
    const m = (total % 12) + 1
    if (`${y}-${String(m).padStart(2, '0')}-01` > until) break
    const key = day <= daysInMonth(y, m) ? makeKey(y, m, day) : null
    if (key && !emit(key)) break
  }
  return out
}

/** 界面上的快捷选项 */
export const REPEAT_PRESETS = {
  none: null,
  daily: { freq: 'daily' },
  workdays: { freq: 'weekly', byWeekday: [1, 2, 3, 4, 5] },
  weekly: { freq: 'weekly' },
  monthly: { freq: 'monthly' },
  yearly: { freq: 'yearly' },
} as const satisfies Record<string, Repeat | null>
export type RepeatPreset = keyof typeof REPEAT_PRESETS

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六']

/** "每周一、三" "工作日" "每 2 周" "每月 15 日" 这类中文描述 */
export function describeRepeat(r: Repeat | null, start: DateKey): string {
  if (!r) return '不重复'
  const every = (unit: string) => (r.interval && r.interval > 1 ? `每 ${r.interval} ${unit}` : `每${unit}`)
  let text: string
  if (r.freq === 'daily') text = r.interval && r.interval > 1 ? `每 ${r.interval} 天` : '每天'
  else if (r.freq === 'weekly') {
    const days = r.byWeekday?.length ? [...r.byWeekday] : [weekday(start)]
    const sorted = days.sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    if ((!r.interval || r.interval === 1) && sorted.join() === '1,2,3,4,5') text = '工作日'
    else text = `${every('周')}${sorted.map((d) => WEEKDAY_CN[d]).join('、')}`
  } else if (r.freq === 'monthly') text = `${every('月')} ${splitKey(start).day} 日`
  else {
    const { month, day } = splitKey(start)
    text = `${every('年')} ${month}月${day}日`
  }
  if (r.until) text += `，到 ${r.until} 为止`
  else if (r.count) text += `，共 ${r.count} 次`
  return text
}

/** 用于判断"界面上选的是哪个快捷项" */
export function presetOf(r: Repeat | null): RepeatPreset | 'custom' {
  if (!r) return 'none'
  if (r.interval && r.interval > 1) return 'custom'
  if (r.freq === 'weekly') {
    const days = r.byWeekday ?? []
    if (days.length === 0) return 'weekly'
    if ([...days].sort().join() === '1,2,3,4,5') return 'workdays'
    return days.length === 1 ? 'weekly' : 'custom'
  }
  return r.freq
}

