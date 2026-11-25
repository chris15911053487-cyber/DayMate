import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { MailCheck } from 'lucide-react'
import { forgotPasswordSchema, passwordSchema } from '@daymate/shared'
import { api, ApiError } from '../../api/client'
import { auth, useAuth } from '../../auth/store'
import { Alert, Button, TextField } from '../../ui'
import { AuthLayout } from './AuthLayout'
import { fieldErrors, useFormState } from './form'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const { errors, setErrors, busy, submit } = useFormState<'email'>()

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const fe = fieldErrors(forgotPasswordSchema, { email })
    setErrors(fe)
    if (Object.keys(fe).length) return
    await submit(async () => {
      await api('/auth/forgot-password', { method: 'POST', body: { email }, retryAuth: false })
      setSent(true)
    })
  }

  return (
    <AuthLayout
      title="找回密码"
      subtitle={sent ? undefined : '输入注册时用的邮箱，我们会发一个重置密码的链接。'}
      footer={<Link to="/login" className="text-primary">返回登录</Link>}
    >
      {sent ? (
        <div className="flex flex-col items-center py-2 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary">
            <MailCheck size={26} />
          </span>
          <p className="mt-4 text-[15px] leading-relaxed text-fg-2">
            如果 <b className="text-fg">{email}</b> 注册过 DayMate，重置链接已经发过去了，30 分钟内有效。
          </p>
          <p className="mt-2 text-sm text-muted">没收到的话看看垃圾邮件，或者 1 分钟后再试。</p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {errors._ && <Alert tone="error">{errors._}</Alert>}
          <TextField label="邮箱" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
          <Button type="submit" block loading={busy}>
            发送重置链接
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const { errors, setErrors, busy, submit } = useFormState<'password' | 'confirm'>()

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const fe: Record<string, string> = {}
    const pw = passwordSchema.safeParse(password)
    if (!pw.success) fe.password = pw.error.issues[0]!.message
    if (password !== confirm) fe.confirm = '两次输入的密码不一样'
    setErrors(fe)
    if (Object.keys(fe).length) return
    await submit(async () => {
      await api('/auth/reset-password', { method: 'POST', body: { token, password }, retryAuth: false })
      auth.clear()
      navigate('/login?notice=reset', { replace: true })
    })
  }

  return (
    <AuthLayout title="设置新密码" subtitle="设置后，所有设备都需要用新密码重新登录。" footer={<Link to="/login" className="text-primary">返回登录</Link>}>
      {!token ? (
        <Alert tone="error">链接不完整。请从邮件里重新打开，或者重新申请找回密码。</Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {errors._ && (
            <Alert tone="error" action={<Link to="/forgot-password" className="shrink-0 font-medium underline">重新申请</Link>}>
              {errors._}
            </Alert>
          )}
          <TextField label="新密码" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
          <TextField label="再输一次" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
          <Button type="submit" block loading={busy}>
            确认修改
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}

export function VerifyEmailPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { status } = useAuth()
  const [result, setResult] = useState<'pending' | 'ok' | string>('pending')
  const started = useRef(false)

  useEffect(() => {
    // 令牌只能用一次：开发模式 StrictMode 会执行两次 effect，这里只发一次
    if (started.current) return
    started.current = true
    const token = params.get('token') ?? ''
    api('/auth/verify-email', { method: 'POST', body: { token }, retryAuth: false })
      .then(() => {
        setResult('ok')
        void auth.reloadUser().catch(() => {})
      })
      .catch((err) => setResult(err instanceof ApiError ? err.message : '验证失败，请稍后再试'))
  }, [params])

  return (
    <AuthLayout title="验证邮箱">
      {result === 'pending' && <p className="text-sm text-muted">正在验证…</p>}
      {result === 'ok' && <Alert tone="success">邮箱验证成功。</Alert>}
      {result !== 'pending' && result !== 'ok' && <Alert tone="error">{result}</Alert>}
      {result !== 'pending' && (
        <Button
          block
          className="mt-4"
          variant={result === 'ok' ? 'primary' : 'secondary'}
          onClick={() => navigate(status === 'authed' ? '/' : '/login')}
        >
          {status === 'authed' ? '回到今天' : '去登录'}
        </Button>
      )}
    </AuthLayout>
  )
}

export function LegalPage({ kind }: { kind: 'terms' | 'privacy' }) {
  const title = kind === 'terms' ? '用户协议' : '隐私政策'
  return (
    <AuthLayout title={title}>
      <div className="space-y-3 text-sm leading-relaxed text-fg-2">
        <p>正式文本在上线前（里程碑 M6）补充。</p>
        {kind === 'privacy' && (
          <p>
            目前会保存：用户名、邮箱、密码哈希（不保存明文）、登录设备信息（浏览器标识和 IP）。语音不保存录音，只保存识别出的文字。
          </p>
        )}
      </div>
    </AuthLayout>
  )
}
