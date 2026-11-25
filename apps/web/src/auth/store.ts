import { useSyncExternalStore } from 'react'
import type { AuthResult, LoginInput, Me, RegisterInput } from '@daymate/shared'
import { api, onSessionChange, refreshSession, setSession } from '../api/client'
import { queryClient } from '../api/queries'

export type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'guest'; user: null }
  | { status: 'authed'; user: Me }

let state: AuthState = { status: 'loading', user: null }
const listeners = new Set<() => void>()

function set(next: AuthState) {
  state = next
  listeners.forEach((fn) => fn())
}

onSessionChange((result) => set(result ? { status: 'authed', user: result.user } : { status: 'guest', user: null }))

function applyResult(result: AuthResult) {
  // 换了账号：上一个人的缓存数据不能留
  if (state.user?.id !== result.user.id) queryClient.clear()
  setSession(result)
  set({ status: 'authed', user: result.user })
  return result.user
}

export const auth = {
  /** 打开页面时：有 Cookie 就静默登录 */
  async bootstrap() {
    const result = await refreshSession()
    if (!result && state.status === 'loading') set({ status: 'guest', user: null })
  },
  async login(input: LoginInput) {
    return applyResult(await api<AuthResult>('/auth/login', { method: 'POST', body: input, retryAuth: false }))
  },
  async register(input: RegisterInput) {
    return applyResult(await api<AuthResult>('/auth/register', { method: 'POST', body: input, retryAuth: false }))
  },
  async logout() {
    await api('/auth/logout', { method: 'POST', retryAuth: false }).catch(() => {})
    auth.clear()
  },
  /** 会话已在服务端作废（注销账号、重置密码）时清掉本地状态 */
  clear() {
    queryClient.clear()
    setSession(null)
    set({ status: 'guest', user: null })
  },
  setUser(user: Me) {
    if (state.status !== 'authed') return
    // 时区变了：日期换算全部要重算
    if (state.user.timezone !== user.timezone) void queryClient.invalidateQueries()
    set({ status: 'authed', user })
  },
  async reloadUser() {
    if (state.status !== 'authed') return
    auth.setUser(await api<Me>('/me'))
  },
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => state,
  )
}
