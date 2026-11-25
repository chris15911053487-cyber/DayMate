import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { Bell, CalendarDays, NotebookPen, Palette, Search, Sun, User } from 'lucide-react'
import { AccountBanners } from './AccountBanners'
import { LiveNotifications } from './LiveNotifications'
import { useUnread } from '../api/queries'
import { Toaster } from '../ui/toast'
import { AssistantSheet } from '../voice/AssistantSheet'
import { openAssistant } from '../voice/assistant'
import { VoiceButton } from '../voice/VoiceButton'
import type { SpeechResult } from '@daymate/shared'

const NAV = [
  { to: '/', label: '今天', icon: Sun },
  { to: '/calendar', label: '日历', icon: CalendarDays },
  { to: '/journal', label: '记录', icon: NotebookPen },
  { to: '/me', label: '我的', icon: User },
] as const

/**
 * 外壳：手机是顶栏 + 底部导航（中间大语音按钮）；电脑（lg 及以上）是左侧导航栏。
 */
export function AppShell() {
  const unread = useUnread().data?.unread ?? 0
  const badge = unread > 0 && (
    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-primary-fg" aria-label={`${unread} 条未读`}>
      {unread > 99 ? '99+' : unread}
    </span>
  )
  const onVoice = (r: SpeechResult) => openAssistant({ text: r.text, voiceLogId: r.voiceLogId, inputMode: 'voice' })
  const onTap = () => openAssistant({ inputMode: 'text' })
  // 主题样张要并排放三个手机框，不限宽
  const wide = useLocation().pathname === '/styles'

  return (
    <div className="min-h-dvh lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-1 border-r border-line p-4 lg:flex">
        <div className="display mb-6 px-3 text-2xl">DayMate</div>
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-control px-3 py-2.5 text-[15px] ${
                isActive ? 'bg-primary-soft font-medium text-primary' : 'text-fg-2 hover:bg-surface-2'
              }`
            }
          >
            <Icon size={18} /> {label}
          </NavLink>
        ))}
        <NavLink
          to="/search"
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-control px-3 py-2.5 text-[15px] ${
              isActive ? 'bg-primary-soft font-medium text-primary' : 'text-fg-2 hover:bg-surface-2'
            }`
          }
        >
          <Search size={18} /> 搜索
        </NavLink>
        <NavLink
          to="/inbox"
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-control px-3 py-2.5 text-[15px] ${
              isActive ? 'bg-primary-soft font-medium text-primary' : 'text-fg-2 hover:bg-surface-2'
            }`
          }
        >
          <span className="relative">
            <Bell size={18} />
            {badge}
          </span>
          消息
        </NavLink>
        <NavLink
          to="/styles"
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-control px-3 py-2.5 text-[15px] ${
              isActive ? 'bg-primary-soft font-medium text-primary' : 'text-fg-2 hover:bg-surface-2'
            }`
          }
        >
          <Palette size={18} /> 主题样张
        </NavLink>
        <div className="mt-auto flex flex-col items-center gap-2 pb-2">
          <VoiceButton onText={onVoice} onTap={onTap} />
          <span className="text-xs text-muted">按住说话 · 点一下打字</span>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-bg/80 px-4 py-3 backdrop-blur lg:hidden">
          <span className="display text-xl">DayMate</span>
          <div className="flex items-center gap-1">
            <Link to="/search" aria-label="搜索" className="p-1.5 text-fg-2">
              <Search size={20} />
            </Link>
            <Link to="/inbox" aria-label="消息" className="relative p-1.5 text-fg-2">
              <Bell size={20} />
              {badge}
            </Link>
          </div>
        </header>

        <main className={`mx-auto w-full ${wide ? 'max-w-6xl' : 'max-w-2xl'} px-4 pb-32 pt-4 lg:pb-10 lg:pt-8`}>
          <div className="mb-4 empty:hidden">
            <AccountBanners />
          </div>
          <Outlet />
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5 items-end">
          {NAV.slice(0, 2).map((item) => (
            <TabLink key={item.to} {...item} />
          ))}
          <div className="flex justify-center">
            <div className="-mt-7">
              <VoiceButton onText={onVoice} onTap={onTap} />
            </div>
          </div>
          {NAV.slice(2).map((item) => (
            <TabLink key={item.to} {...item} />
          ))}
        </div>
      </nav>
      <AssistantSheet />
      <LiveNotifications />
      <Toaster />
    </div>
  )
}

function TabLink({ to, label, icon: Icon }: (typeof NAV)[number]) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex flex-col items-center gap-0.5 py-2 text-[11px] ${isActive ? 'text-primary' : 'text-muted'}`
      }
    >
      <Icon size={22} />
      {label}
    </NavLink>
  )
}
