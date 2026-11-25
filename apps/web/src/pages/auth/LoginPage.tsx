import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { loginSchema } from '@daymate/shared'
import { auth } from '../../auth/store'
import { Alert, Button, TextField } from '../../ui'
import { AuthLayout } from './AuthLayout'
import { fieldErrors, useFormState } from './form'

/** 只接受站内路径，防止 ?next= 被拿来跳到别的网站 */
export function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}

export function LoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const { errors, setErrors, clearError, busy, submit } = useFormState<'account' | 'password'>()
  const notice = params.get('notice')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const input = { account, password }
    const fe = fieldErrors(loginSchema, input)
    setErrors(fe)
    if (Object.keys(fe).length) return
    await submit(async () => {
      await auth.login(input)
      navigate(safeNext(params.get('next')), { replace: true })
    })
  }

  return (
    <AuthLayout
      title="登录"
      footer={
        <>
          还没有账号？<Link to="/register" className="font-medium text-primary">注册一个</Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {notice === 'reset' && <Alert tone="success">密码已重置，用新密码登录吧。</Alert>}
        {notice === 'deleted' && <Alert tone="info">已申请注销。7 天内重新登录可以撤销。</Alert>}
        {errors._ && <Alert tone="error">{errors._}</Alert>}
        <TextField
          label="用户名或邮箱"
          autoComplete="username"
          autoCapitalize="none"
          value={account}
          onChange={(e) => {
            setAccount(e.target.value)
            clearError('account')
          }}
          error={errors.account}
        />
        <TextField
          label="密码"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            clearError('password')
          }}
          error={errors.password}
        />
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm text-muted hover:text-primary">
            忘记密码？
          </Link>
        </div>
        <Button type="submit" block loading={busy}>
          登录
        </Button>
      </form>
    </AuthLayout>
  )
}
