import { useEffect, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CircleCheck, Eye, EyeOff, Info, LoaderCircle, TriangleAlert, X } from 'lucide-react'

export const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
const BUTTON: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-fg hover:opacity-90',
  secondary: 'card text-fg hover:bg-surface-2',
  ghost: 'text-fg-2 hover:bg-surface-2',
  danger: 'bg-danger text-primary-fg hover:opacity-90',
}

export function Button({
  variant = 'primary',
  loading,
  block,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean; block?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-control px-4 py-2.5 text-[15px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON[variant],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && <LoaderCircle size={16} className="animate-spin" />}
      {children}
    </button>
  )
}

export function TextField({
  label,
  error,
  hint,
  type = 'text',
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: ReactNode }) {
  const id = useId()
  const [reveal, setReveal] = useState(false)
  const isPassword = type === 'password'
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block px-0.5 text-sm font-medium text-fg-2">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={isPassword && reveal ? 'text' : type}
          aria-invalid={!!error}
          aria-describedby={error || hint ? `${id}-msg` : undefined}
          className={cn(
            'w-full rounded-control border bg-surface px-3.5 py-2.5 text-[16px] text-fg outline-none transition placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/20',
            error ? 'border-danger' : 'border-line',
            isPassword && 'pr-11',
          )}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            aria-label={reveal ? '隐藏密码' : '显示密码'}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted"
          >
            {reveal ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
      </div>
      {(error || hint) && (
        <p id={`${id}-msg`} className={cn('px-0.5 text-xs leading-relaxed', error ? 'text-danger' : 'text-muted')}>
          {error || hint}
        </p>
      )}
    </div>
  )
}

const ALERT = {
  error: { cls: 'bg-danger/10 text-danger', Icon: TriangleAlert },
  success: { cls: 'bg-success/10 text-success', Icon: CircleCheck },
  info: { cls: 'bg-accent-soft text-accent', Icon: Info },
} as const

export function Alert({ tone = 'info', children, action }: { tone?: keyof typeof ALERT; children: ReactNode; action?: ReactNode }) {
  const { cls, Icon } = ALERT[tone]
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex items-start gap-2.5 rounded-control px-3.5 py-3 text-sm leading-relaxed', cls)}>
      <Icon size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  )
}

/** 手机上从底部弹出，电脑上居中 */
export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-fg/40" onClick={onClose} />
      <div className="app-surface relative w-full max-w-md rounded-t-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl sm:rounded-card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="display text-lg">{title}</h2>
          <button type="button" onClick={onClose} aria-label="关闭" className="-mr-1 p-1 text-muted">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** 原生输入框的通用样式（日期、时间、下拉） */
export const inputCls =
  'w-full rounded-control border border-line bg-surface px-3 py-2.5 text-[16px] text-fg outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20'

export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block px-0.5 text-sm font-medium text-fg-2">
      {children}
    </label>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-line')}
    >
      <span className={cn('absolute top-0.5 size-5 rounded-full bg-surface shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
    </button>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-control bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('rounded-control px-3 py-1 text-sm transition', value === o.value ? 'bg-surface font-medium text-fg shadow-sm' : 'text-muted')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
