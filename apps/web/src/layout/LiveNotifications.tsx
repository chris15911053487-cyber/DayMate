import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { NotificationPage } from '@daymate/shared'
import { api } from '../api/client'
import { useUnread } from '../api/queries'
import { toast } from '../ui/toast'

/**
 * 应用开着时的"页内提醒"（docs/技术方案.md 9.2：站内消息兜底）：未读数变多了就弹出最新一条；
 * Service Worker 收到推送 / 点了系统通知也会通知这里刷新、跳转。
 */
export function LiveNotifications() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data } = useUnread()
  const prev = useRef<number | null>(null)

  useEffect(() => {
    const unread = data?.unread
    if (unread == null) return
    if (prev.current != null && unread > prev.current) {
      void api<NotificationPage>('/notifications').then((page) => {
        const n = page.items[0]
        if (!n) return
        toast(n.title, n.link ? { label: '查看', onClick: () => navigate(n.link!) } : undefined)
        void qc.invalidateQueries({ queryKey: ['today'] })
        void qc.invalidateQueries({ queryKey: ['notifications', 'list'] })
      })
    }
    prev.current = unread
  }, [data?.unread, navigate, qc])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'daymate:push') void qc.invalidateQueries({ queryKey: ['notifications'] })
      if (e.data?.type === 'daymate:navigate' && typeof e.data.url === 'string') navigate(e.data.url)
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [navigate, qc])

  return null
}
