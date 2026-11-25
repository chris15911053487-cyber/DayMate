import type { ApiError as ApiErrorBody, AuthResult } from '@daymate/shared'

/**
 * 接口调用：访问令牌只放内存（不放 localStorage，防 XSS 窃取）；刷新令牌在 HttpOnly Cookie 里，前端读不到。
 * 遇到 401 自动用 Cookie 换新访问令牌再重试一次。多个标签页同时刷新时用 Web Locks 排队，
 * 后到的标签页会带上前一个刚换来的新 Cookie（docs/技术方案.md 5.3）。
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

let accessToken: string | null = null
type SessionListener = (result: AuthResult | null) => void
const sessionListeners = new Set<SessionListener>()

/** 刷新成功（新用户信息）或失败（null = 需要重新登录）时通知 */
export function onSessionChange(fn: SessionListener) {
  sessionListeners.add(fn)
  return () => sessionListeners.delete(fn)
}

export function setSession(result: AuthResult | null) {
  accessToken = result?.accessToken ?? null
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  /** 是否在 401 时自动刷新重试（登录、注册等接口不需要） */
  retryAuth?: boolean
}

async function send(path: string, opts: RequestOptions) {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  if (accessToken) headers.authorization = `Bearer ${accessToken}`
  return fetch(`/api${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    credentials: 'same-origin',
  })
}

async function readBody<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = data as Partial<ApiErrorBody> | null
    throw new ApiError(res.status, err?.code ?? 'HTTP_' + res.status, err?.error ?? '网络出错了，请稍后再试')
  }
  return data as T
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res: Response
  try {
    res = await send(path, opts)
    if (res.status === 401 && opts.retryAuth !== false && accessToken) {
      if (await refreshSession()) res = await send(path, opts)
    }
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError(0, 'NETWORK', '连不上服务器，请检查网络')
  }
  return readBody<T>(res)
}

let refreshing: Promise<AuthResult | null> | null = null

/** 用 Cookie 里的刷新令牌换新访问令牌；同一标签页内并发调用只发一次 */
export function refreshSession(): Promise<AuthResult | null> {
  refreshing ??= withRefreshLock(doRefresh).finally(() => {
    refreshing = null
  })
  return refreshing
}

function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  return locks ? locks.request('daymate-refresh', fn) : fn()
}

async function doRefresh(): Promise<AuthResult | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response
    try {
      res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    } catch {
      // 断网时保留现有登录状态，等网络恢复
      return null
    }
    if (res.ok) {
      const result = (await res.json()) as AuthResult
      setSession(result)
      sessionListeners.forEach((fn) => fn(result))
      return result
    }
    // 另一个标签页刚换过令牌：稍等一下用新 Cookie 重试
    if (res.status === 409) {
      await new Promise((r) => setTimeout(r, 300))
      continue
    }
    break
  }
  setSession(null)
  sessionListeners.forEach((fn) => fn(null))
  return null
}
