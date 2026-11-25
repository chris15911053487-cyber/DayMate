/*
 * DayMate Service Worker：只负责推送（docs/技术方案.md 9.2），不缓存页面（P1 不做离线）。
 * 收到推送 → 弹系统通知；点通知 → 打开（或聚焦已打开的）DayMate 并跳到对应页面。
 */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'DayMate', body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'DayMate'
  event.waitUntil(
    (async () => {
      // 页面开着时也弹系统通知（页面里另外有消息提示），保证锁屏、切到别的应用时能看到
      await self.registration.showNotification(title, {
        body: data.body || '',
        tag: data.tag,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: { url: data.url || '/inbox', notificationId: data.notificationId },
      })
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      clients.forEach((c) => c.postMessage({ type: 'daymate:push', notificationId: data.notificationId }))
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const same = clients.find((c) => new URL(c.url).origin === self.location.origin)
      if (same) {
        await same.focus()
        same.postMessage({ type: 'daymate:navigate', url })
        return
      }
      await self.clients.openWindow(url)
    })(),
  )
})
