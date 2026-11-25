import { useState } from 'react'
import type { Me } from '@daymate/shared'
import { api, ApiError } from '../api/client'
import { auth, useAuth } from '../auth/store'
import { Alert } from '../ui'

/** 顶部提示：申请注销中（可撤销）、邮箱未验证（可重发） */
export function AccountBanners() {
  const { user } = useAuth()
  const [sent, setSent] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)
  if (!user) return null

  if (user.pendingDeletion) {
    const day = new Date(user.pendingDeletion.purgeAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
    return (
      <Alert
        tone="error"
        action={
          <button
            type="button"
            className="shrink-0 font-medium underline"
            onClick={async () => auth.setUser(await api<Me>('/me/cancel-deletion', { method: 'POST' }))}
          >
            撤销注销
          </button>
        }
      >
        账号将在 {day} 彻底删除，所有数据无法恢复。
      </Alert>
    )
  }

  if (!user.emailVerified && !hidden) {
    const resend = async () => {
      try {
        await api('/auth/resend-verification', { method: 'POST' })
        setSent(`验证邮件已发到 ${user.email}`)
      } catch (err) {
        setSent(err instanceof ApiError ? err.message : '发送失败，请稍后再试')
      }
    }
    return (
      <Alert
        tone="info"
        action={
          <button type="button" className="shrink-0 text-xs opacity-70" onClick={() => setHidden(true)}>
            稍后
          </button>
        }
      >
        {sent ?? (
          <>
            邮箱还没验证，忘记密码时将无法找回。
            <button type="button" className="ml-1 font-medium underline" onClick={resend}>
              重发验证邮件
            </button>
          </>
        )}
      </Alert>
    )
  }
  return null
}
