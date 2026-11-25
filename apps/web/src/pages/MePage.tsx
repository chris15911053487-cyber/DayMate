import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { BadgeCheck, BellRing, ChevronRight, KeyRound, LogOut, Monitor, Pencil, Smartphone, Trash2 } from 'lucide-react'
import { ACCOUNT_DELETION_DAYS, changePasswordSchema, passwordProblem, type Me, type SessionInfo } from '@daymate/shared'
import { api, ApiError } from '../api/client'
import { auth, useAuth } from '../auth/store'
import { CalendarsSetting, TimezoneSetting } from '../components/Settings'
import { ThemePicker } from '../components/ThemePicker'
import { Alert, Button, Modal, TextField } from '../ui'
import { describeDevice, relativeTime } from '../utils/device'
import { fieldErrors, useFormState } from './auth/form'

export function MePage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  if (!user) return null

  return (
    <div className="space-y-7">
      <ProfileCard user={user} />

      <Section title="主题">
        <ThemePicker />
        <Link to="/styles" className="card flex items-center justify-between px-4 py-3 text-[15px]">
          对比全部主题样张
          <ChevronRight size={18} className="text-muted" />
        </Link>
      </Section>

      <Section title="日历">
        <Link to="/me/notifications" className="card flex items-center gap-3 px-4 py-3.5 text-[15px]">
          <BellRing size={18} className="text-muted" />
          <span className="flex-1">提醒与推送</span>
          <ChevronRight size={18} className="text-muted" />
        </Link>
        <TimezoneSetting />
        <CalendarsSetting />
      </Section>

      <Section title="账号安全">
        <div className="card divide-y divide-line">
          <ChangePasswordRow />
        </div>
        <Sessions />
      </Section>

      <Section title="其他">
        <div className="card divide-y divide-line">
          <Link to="/privacy" className="flex items-center justify-between px-4 py-3.5 text-[15px]">
            隐私政策 <ChevronRight size={18} className="text-muted" />
          </Link>
          <Link to="/terms" className="flex items-center justify-between px-4 py-3.5 text-[15px]">
            用户协议 <ChevronRight size={18} className="text-muted" />
          </Link>
          <DeleteAccountRow />
        </div>
        <Button
          variant="secondary"
          block
          onClick={async () => {
            await auth.logout()
            navigate('/login', { replace: true })
          }}
        >
          <LogOut size={18} /> 退出登录
        </Button>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="display px-1 text-base">{title}</h2>
      {children}
    </section>
  )
}

function ProfileCard({ user }: { user: Me }) {
  const [editing, setEditing] = useState(false)
  const [nickname, setNickname] = useState(user.nickname ?? '')
  const [error, setError] = useState<string>()
  const display = user.nickname || user.username

  async function save(e: FormEvent) {
    e.preventDefault()
    try {
      auth.setUser(await api<Me>('/me', { method: 'PATCH', body: { nickname: nickname.trim() || null } }))
      setEditing(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败')
    }
  }

  return (
    <div className="card flex items-center gap-4 p-4">
      <span className="display flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-2xl text-primary-fg">
        {display.slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        {editing ? (
          <form onSubmit={save} className="flex items-center gap-2">
            <input
              autoFocus
              value={nickname}
              maxLength={30}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="起个昵称"
              aria-label="昵称"
              className="min-w-0 flex-1 rounded-control border border-line bg-surface px-2.5 py-1.5 text-[16px] outline-none focus:border-primary"
            />
            <Button type="submit" className="px-3 py-1.5 text-sm">保存</Button>
          </form>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="flex items-center gap-1.5 text-left">
            <span className="display truncate text-xl">{display}</span>
            <Pencil size={14} className="shrink-0 text-muted" />
          </button>
        )}
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
        <p className="mt-0.5 truncate text-sm text-muted">@{user.username}</p>
        <p className="mt-0.5 flex items-center gap-1 truncate text-sm text-muted">
          {user.email}
          {user.emailVerified ? (
            <BadgeCheck size={15} className="shrink-0 text-success" aria-label="已验证" />
          ) : (
            <span className="shrink-0 rounded-control bg-warning/15 px-1.5 text-[11px] text-warning">未验证</span>
          )}
        </p>
      </div>
    </div>
  )
}

function ChangePasswordRow() {
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState(false)
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' })
  const { errors, setErrors, busy, submit } = useFormState<'currentPassword' | 'newPassword' | 'confirm'>()
  const { user } = useAuth()

  function close() {
    setOpen(false)
    setDone(false)
    setForm({ currentPassword: '', newPassword: '', confirm: '' })
    setErrors({})
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const fe = fieldErrors(changePasswordSchema, form)
    const problem = !fe.newPassword && passwordProblem(form.newPassword, user ?? {})
    if (problem) fe.newPassword = problem
    if (form.newPassword !== form.confirm) fe.confirm = '两次输入的新密码不一样'
    setErrors(fe)
    if (Object.keys(fe).length) return
    await submit(
      async () => {
        await api('/me/password', { method: 'PUT', body: { currentPassword: form.currentPassword, newPassword: form.newPassword } })
        setDone(true)
      },
      { WRONG_PASSWORD: 'currentPassword' },
    )
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-[15px]">
        <KeyRound size={18} className="text-muted" />
        <span className="flex-1">修改密码</span>
        <ChevronRight size={18} className="text-muted" />
      </button>
      <Modal open={open} title="修改密码" onClose={close}>
        {done ? (
          <div className="space-y-4">
            <Alert tone="success">密码已修改。其他设备需要用新密码重新登录。</Alert>
            <Button block onClick={close}>好的</Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {errors._ && <Alert tone="error">{errors._}</Alert>}
            <TextField label="当前密码" type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} error={errors.currentPassword} />
            <TextField label="新密码" type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} error={errors.newPassword} />
            <TextField label="再输一次新密码" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} error={errors.confirm} />
            <Button type="submit" block loading={busy}>确认修改</Button>
          </form>
        )}
      </Modal>
    </>
  )
}

function Sessions() {
  const [list, setList] = useState<SessionInfo[] | null>(null)
  const [error, setError] = useState<string>()

  const load = () =>
    api<SessionInfo[]>('/me/sessions')
      .then(setList)
      .catch((err) => setError(err instanceof ApiError ? err.message : '加载失败'))

  useEffect(() => {
    void load()
  }, [])

  async function kick(id: string) {
    await api(`/me/sessions/${id}`, { method: 'DELETE' }).catch(() => {})
    await load()
  }

  return (
    <div className="card">
      <div className="flex items-baseline justify-between px-4 pt-3.5">
        <span className="text-[15px]">登录设备</span>
        {list && <span className="text-xs text-muted">{list.length} 台</span>}
      </div>
      {error && <p className="px-4 py-3 text-sm text-danger">{error}</p>}
      <ul className="divide-y divide-line">
        {list?.map((s) => {
          const name = describeDevice(s.userAgent)
          const Icon = /iPhone|Android|iPad/.test(name) ? Smartphone : Monitor
          return (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3">
              <Icon size={20} className="shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px]">
                  {name}
                  {s.current && <span className="ml-2 rounded-control bg-primary-soft px-1.5 py-0.5 text-[11px] text-primary">本机</span>}
                </p>
                <p className="truncate text-xs text-muted">
                  {relativeTime(s.lastUsedAt)}活跃{s.ip ? ` · ${s.ip}` : ''}
                </p>
              </div>
              {!s.current && (
                <Button variant="ghost" className="px-2.5 py-1 text-sm" onClick={() => kick(s.id)}>
                  退出
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function DeleteAccountRow() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const { errors, setErrors, busy, submit } = useFormState<'password'>()

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!password) return setErrors({ password: '请输入密码' })
    await submit(
      async () => {
        await api('/me', { method: 'DELETE', body: { password } })
        auth.clear()
        navigate('/login?notice=deleted', { replace: true })
      },
      { WRONG_PASSWORD: 'password' },
    )
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-[15px] text-danger">
        <Trash2 size={18} />
        <span className="flex-1">注销账号</span>
      </button>
      <Modal open={open} title="注销账号" onClose={() => setOpen(false)}>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Alert tone="error">
            注销后所有设备立即退出。{ACCOUNT_DELETION_DAYS} 天内重新登录可以撤销；过了 {ACCOUNT_DELETION_DAYS}{' '}
            天，账号和全部日程、记录会被彻底删除，无法恢复。
          </Alert>
          {errors._ && <Alert tone="error">{errors._}</Alert>}
          <TextField label="输入密码确认" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
          <Button type="submit" variant="danger" block loading={busy}>确认注销</Button>
        </form>
      </Modal>
    </>
  )
}
