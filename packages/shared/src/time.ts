/**
 * 日期与时区工具（前后端共用，不依赖第三方库）。
 * - "日期键" = 'YYYY-MM-DD'，表示某个时区里的一天，日期运算一律按 UTC 午夜算，避免本机时区干扰。
 * - "墙上时间" = 'HH:mm'。
 * - 瞬间（Date / ISO）⇄ 某时区的墙上时间，用 Intl 计算，支持夏令时。
 */

export type DateKey = string
export const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

const pad = (n: number) => String(n).padStart(2, '0')

export function isDateKey(s: string): boolean {
  if (!DATE_KEY_RE.test(s)) return false
  const d = keyToUtc(s)
  return toKey(d) === s
}

function keyToUtc(key: DateKey): Date {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d))
}
function toKey(d: Date): DateKey {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function addDays(key: DateKey, n: number): DateKey {
  const d = keyToUtc(key)
  d.setUTCDate(d.getUTCDate() + n)
  return toKey(d)
}

/** b - a 相差几天 */
export function diffDays(a: DateKey, b: DateKey): number {
  return Math.round((keyToUtc(b).getTime() - keyToUtc(a).getTime()) / 86400_000)
}

/** 0 = 周日 … 6 = 周六 */
export function weekday(key: DateKey): number {
  return keyToUtc(key).getUTCDay()
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate()
}

export function makeKey(year: number, month1: number, day: number): DateKey | null {
  if (month1 < 1 || month1 > 12 || day < 1 || day > daysInMonth(year, month1)) return null
  return `${year}-${pad(month1)}-${pad(day)}`
}

export function splitKey(key: DateKey) {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number]
  return { year, month, day }
}

/** 所在周的周一（ISO 周，周一开始） */
export function startOfWeek(key: DateKey): DateKey {
  return addDays(key, -((weekday(key) + 6) % 7))
}

export function startOfMonth(key: DateKey): DateKey {
  return key.slice(0, 8) + '01'
}

export function addMonths(key: DateKey, n: number): DateKey {
  const { year, month, day } = splitKey(key)
  const total = year * 12 + (month - 1) + n
  const y = Math.floor(total / 12)
  const m = (total % 12) + 1
  return makeKey(y, m, Math.min(day, daysInMonth(y, m)))!
}

const partsCache = new Map<string, Intl.DateTimeFormat>()
function formatter(tz: string) {
  let f = partsCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    partsCache.set(tz, f)
  }
  return f
}

/** 某个瞬间在时区 tz 里的墙上时间 */
export function zonedParts(instant: Date | number | string, tz: string) {
  const d = new Date(instant)
  const p: Record<string, number> = {}
  for (const part of formatter(tz).formatToParts(d)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value)
  }
  const date = `${p.year}-${pad(p.month!)}-${pad(p.day!)}`
  return {
    date,
    time: `${pad(p.hour!)}:${pad(p.minute!)}`,
    hour: p.hour!,
    minute: p.minute!,
    second: p.second!,
    weekday: weekday(date),
  }
}

/** 时区 tz 在该瞬间相对 UTC 的偏移（毫秒，东八区为 +8h） */
export function tzOffsetMs(instant: Date | number, tz: string): number {
  const d = new Date(instant)
  const p = zonedParts(d, tz)
  const { year, month, day } = splitKey(p.date)
  const asUtc = Date.UTC(year, month - 1, day, p.hour, p.minute, p.second)
  return asUtc - (Math.floor(d.getTime() / 1000) * 1000)
}

/** 时区 tz 里的"某天几点"对应的瞬间。夏令时跳过的时刻顺延，重复的时刻取第一个。 */
export function zonedToUtc(date: DateKey, time: string, tz: string): Date {
  const { year, month, day } = splitKey(date)
  const [h, m] = time.split(':').map(Number) as [number, number]
  const wall = Date.UTC(year, month - 1, day, h, m)
  // 用墙上时间附近两个时刻的偏移各算一次：正常只有一个解；重复时刻两个都对（取早的）；
  // 被夏令时跳过的时刻都不对（取晚的，即顺延）
  const candidates = [...new Set([wall - tzOffsetMs(wall - 86400_000, tz), wall - tzOffsetMs(wall + 86400_000, tz)])].sort((a, b) => a - b)
  const exact = candidates.filter((c) => {
    const p = zonedParts(c, tz)
    return p.date === date && p.time === time
  })
  return new Date(exact.length ? exact[0]! : candidates[candidates.length - 1]!)
}

/** 时区 tz 里某天 00:00 的瞬间 */
export const startOfDayUtc = (date: DateKey, tz: string) => zonedToUtc(date, '00:00', tz)

export function todayKey(tz: string, now: Date | number = Date.now()): DateKey {
  return zonedParts(now, tz).date
}

export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number) as [number, number]
  return h * 60 + m
}

export function timeOfMinutes(min: number): string {
  const m = ((min % 1440) + 1440) % 1440
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六']
export const weekdayLabel = (key: DateKey) => '周' + WEEKDAY_CN[weekday(key)]

/** 相对今天的叫法：今天 / 明天 / 后天 / 昨天 / 11月30日 周日 */
export function relativeDayLabel(key: DateKey, today: DateKey): string {
  const d = diffDays(today, key)
  if (d === 0) return '今天'
  if (d === 1) return '明天'
  if (d === 2) return '后天'
  if (d === -1) return '昨天'
  const { year, month, day } = splitKey(key)
  const base = `${month}月${day}日`
  return year === splitKey(today).year ? `${base} ${weekdayLabel(key)}` : `${year}年${base}`
}
