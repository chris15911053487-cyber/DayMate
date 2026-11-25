import type { ReactNode } from 'react'
import { Link } from 'react-router'

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 pb-10 pt-[max(3rem,env(safe-area-inset-top))] sm:justify-center sm:pt-10">
      <Link to="/" className="display mb-2 text-3xl">
        DayMate
      </Link>
      <p className="mb-8 text-sm text-muted">会听你说话的日历和小助手</p>
      <div className="card w-full max-w-sm p-6">
        <h1 className="display text-xl">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm leading-relaxed text-muted">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
      {footer && <div className="mt-6 text-sm text-fg-2">{footer}</div>}
    </div>
  )
}
