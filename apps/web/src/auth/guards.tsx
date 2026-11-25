import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from './store'

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <span className="display animate-pulse text-2xl text-muted">DayMate</span>
    </div>
  )
}

/** 没登录跳到登录页，登录后回到原来要去的地方 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const loc = useLocation()
  if (status === 'loading') return <Splash />
  if (status === 'guest') {
    const next = loc.pathname + loc.search
    return <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />
  }
  return <>{children}</>
}

/** 已登录的人打开登录、注册页时直接进应用 */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  if (status === 'loading') return <Splash />
  if (status === 'authed') return <Navigate to="/" replace />
  return <>{children}</>
}
