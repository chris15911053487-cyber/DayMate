import { useNavigate } from 'react-router'
import { Bell, CalendarClock, Info, Sparkles } from 'lucide-react'
import type { NotificationItem, NotificationKind } from '@daymate/shared'
import { useNotificationMutations, useNotifications } from '../api/queries'
import { Button, cn } from '../ui'
import { relativeTime } from '../utils/device'

const KIND_ICON: Record<NotificationKind, typeof Bell> = { reminder: CalendarClock, brief: Sparkles, suggestion: Sparkles, system: Info }

/** 消息中心：提醒、早报、复盘、系统通知（docs/技术方案.md 9.1） */
export function InboxPage() {
  const navigate = useNavigate()
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useNotifications()
  const { read, readAll } = useNotificationMutations()
  const items = data?.pages.flatMap((p) => p.items) ?? []
  const unread = data?.pages[0]?.unread ?? 0

  const open = (n: NotificationItem) => {
    if (!n.readAt) read.mutate(n.id)
    if (n.link) navigate(n.link)
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between px-1">
        <h1 className="display text-[22px]">消息</h1>
        {unread > 0 && (
          <Button variant="ghost" className="px-3 py-1 text-sm" onClick={() => readAll.mutate()}>
            全部已读
          </Button>
        )}
      </header>
      {isLoading ? (
        <p className="py-6 text-center text-sm text-muted">加载中…</p>
      ) : !items.length ? (
        <p className="card px-4 py-8 text-center text-sm text-muted">还没有消息。日程提醒、早报和晚间复盘会出现在这里。</p>
      ) : (
        <ul className="card divide-y divide-line">
          {items.map((n) => {
            const Icon = KIND_ICON[n.kind]
            return (
              <li key={n.id}>
                <button type="button" onClick={() => open(n)} className="flex w-full items-start gap-3 px-4 py-3 text-left">
                  <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full', n.readAt ? 'bg-surface-2 text-muted' : 'bg-primary-soft text-primary')}>
                    <Icon size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={cn('min-w-0 flex-1 truncate text-[15px]', !n.readAt && 'font-medium')}>{n.title}</span>
                      <span className="shrink-0 text-xs text-muted">{relativeTime(n.createdAt)}</span>
                    </span>
                    {n.body && <span className="mt-0.5 line-clamp-2 block text-sm text-fg-2">{n.body}</span>}
                  </span>
                  {!n.readAt && <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" aria-label="未读" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {hasNextPage && (
        <Button variant="secondary" block loading={isFetchingNextPage} onClick={() => fetchNextPage()}>
          更早的消息
        </Button>
      )}
    </div>
  )
}
