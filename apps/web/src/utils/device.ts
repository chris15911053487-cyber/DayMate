/** 把 User-Agent 粗略翻成"iPhone · 微信"这样的设备名，给登录设备列表用 */
export function describeDevice(ua: string | null): string {
  if (!ua) return '未知设备'
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android 手机'
        : /Macintosh|Mac OS X/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows 电脑'
            : /Linux/.test(ua)
              ? 'Linux 电脑'
              : ''
  const app = /MicroMessenger/.test(ua)
    ? '微信'
    : /DingTalk/.test(ua)
      ? '钉钉'
      : /Edg\//.test(ua)
        ? 'Edge'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : ''
  return [os, app].filter(Boolean).join(' · ') || '未知设备'
}

/** "刚刚 / 5 分钟前 / 3 小时前 / 11月20日 14:30" */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime()
  const diff = Math.max(0, now - t)
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  const d = new Date(t)
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return new Date(now).getFullYear() === d.getFullYear() ? `${md} ${hm}` : `${d.getFullYear()}年${md}`
}
