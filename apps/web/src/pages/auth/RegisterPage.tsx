import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Check } from 'lucide-react'
import { passwordProblem, registerSchema } from '@daymate/shared'
import { auth } from '../../auth/store'
import { Alert, Button, TextField, cn } from '../../ui'
import { AuthLayout } from './AuthLayout'
import { fieldErrors, useFormState } from './form'

type Field = 'username' | 'email' | 'password' | 'agree'

export function RegisterPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ username: '', email: '', password: '', agree: false })
  const { errors, setErrors, clearError, busy, submit } = useFormState<Field>()
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    clearError(k)
  }

  const pwHint =
    form.password.length >= 8 ? passwordProblem(form.password, form) ?? '密码可以用' : '至少 8 位；字母、数字、符号混着用更安全'

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const fe = fieldErrors(registerSchema, form)
    setErrors(fe)
    if (Object.keys(fe).length) return
    await submit(
      async () => {
        await auth.register({ ...form, agree: true })
        navigate('/', { replace: true })
      },
      { USERNAME_TAKEN: 'username', EMAIL_TAKEN: 'email' },
    )
  }

  return (
    <AuthLayout
      title="注册"
      subtitle="说一句话就能排好日程，晚上 AI 帮你复盘。"
      footer={
        <>
          已经有账号了？<Link to="/login" className="font-medium text-primary">去登录</Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {errors._ && <Alert tone="error">{errors._}</Alert>}
        <TextField
          label="用户名"
          autoComplete="username"
          autoCapitalize="none"
          value={form.username}
          onChange={(e) => set('username', e.target.value)}
          error={errors.username}
          hint="4–20 位，字母开头，可以有数字和下划线"
        />
        <TextField
          label="邮箱"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
          error={errors.email}
          hint="忘记密码时用它找回"
        />
        <TextField
          label="密码"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={(e) => set('password', e.target.value)}
          error={errors.password}
          hint={pwHint}
        />
        <label className="flex cursor-pointer items-start gap-2.5 text-sm leading-relaxed text-fg-2">
          <input type="checkbox" className="peer sr-only" checked={form.agree} onChange={(e) => set('agree', e.target.checked)} />
          <span
            className={cn(
              'mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border-2 peer-focus-visible:ring-2 peer-focus-visible:ring-primary/30',
              form.agree ? 'border-primary bg-primary text-primary-fg' : errors.agree ? 'border-danger' : 'border-line',
            )}
          >
            {form.agree && <Check size={12} strokeWidth={3} />}
          </span>
          <span>
            我已阅读并同意
            <Link to="/terms" target="_blank" className="text-primary">《用户协议》</Link>和
            <Link to="/privacy" target="_blank" className="text-primary">《隐私政策》</Link>
          </span>
        </label>
        {errors.agree && <p className="-mt-2 px-0.5 text-xs text-danger">{errors.agree}</p>}
        <Button type="submit" block loading={busy}>
          注册并登录
        </Button>
      </form>
    </AuthLayout>
  )
}
