import { api } from '../api/client'

/**
 * 这台设备的浏览器推送能力（docs/技术方案.md 9.2）。
 * iPhone 要 iOS 16.4+ 且"添加到主屏幕"后才能订阅；Chrome 在国内依赖 Google 推送服务，基本收不到。
 */
export type PushCapability =
  | { state: 'unsupported'; reason: string }
  | { state: 'needs-install'; reason: string }
  | { state: 'denied'; reason: string }
  | { state: 'available' }
  | { state: 'subscribed' }

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent)
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
export const isWeChat = () => /MicroMessenger/i.test(navigator.userAgent)
/** 国内网络下 Chrome 系（含安卓 Chrome）推送走 Google，大概率收不到 */
export const likelyGooglePush = () => /Chrome\//.test(navigator.userAgent) && !/Edg\//.test(navigator.userAgent)

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.register('/sw.js')
  } catch {
    return null
  }
}

export async function pushCapability(): Promise<PushCapability> {
  if (isWeChat()) return { state: 'unsupported', reason: '微信里收不到推送。点右上角「…」选择「在浏览器打开」。' }
  if (!window.isSecureContext) return { state: 'unsupported', reason: '需要 HTTPS 才能开启推送。' }
  if (isIos() && !isStandalone()) {
    return { state: 'needs-install', reason: 'iPhone 要先把 DayMate 添加到主屏幕：点 Safari 底部的「分享」→「添加到主屏幕」，再从主屏幕打开。' }
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { state: 'unsupported', reason: '这个浏览器不支持推送通知。' }
  }
  if (Notification.permission === 'denied') return { state: 'denied', reason: '通知权限被关掉了，要到浏览器设置里重新允许。' }
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub ? { state: 'subscribed' } : { state: 'available' }
}

function urlBase64ToUint8Array(base64: string) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

/** 申请通知权限并订阅，订阅信息交给服务器 */
export async function enablePush(): Promise<void> {
  const config = await api<{ enabled: boolean; publicKey: string | null }>('/push/config')
  if (!config.enabled || !config.publicKey) throw new Error('服务器还没配置推送')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('没有允许通知')
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await registerServiceWorker())
  if (!reg) throw new Error('推送服务启动失败')
  await navigator.serviceWorker.ready
  let sub: PushSubscription
  try {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(config.publicKey) })
  } catch (err) {
    throw new Error(
      likelyGooglePush()
        ? '订阅失败：这个浏览器的推送服务连不上（国内网络下 Chrome 常见）。可以换 Edge / Safari，或者打开邮件提醒。'
        : `订阅失败：${(err as Error).message}`,
      { cause: err },
    )
  }
  await api('/push/subscriptions', { method: 'POST', body: sub.toJSON() })
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await api('/push/subscriptions', { method: 'DELETE', body: { endpoint: sub.endpoint } }).catch(() => {})
  await sub.unsubscribe()
}
