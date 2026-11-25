import { describe, expect, it } from 'vitest'
import { describeDevice, relativeTime } from './device'

describe('describeDevice', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40', 'iPhone · 微信'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', 'iPhone · Safari'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36', 'Android 手机 · Chrome'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0', 'Windows 电脑 · Edge'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', 'Mac · Chrome'],
    [null, '未知设备'],
    ['curl/8.0', '未知设备'],
  ])('%s', (ua, expected) => expect(describeDevice(ua)).toBe(expected))
})

describe('relativeTime', () => {
  const now = new Date(2026, 10, 24, 22, 0).getTime()
  it.each([
    [now - 10_000, '刚刚'],
    [now - 5 * 60_000, '5 分钟前'],
    [now - 3 * 3600_000, '3 小时前'],
    [new Date(2026, 10, 20, 9, 5).getTime(), '11月20日 09:05'],
    [new Date(2025, 0, 2).getTime(), '2025年1月2日'],
  ])('%s', (t, expected) => expect(relativeTime(new Date(t).toISOString(), now)).toBe(expected))
})
