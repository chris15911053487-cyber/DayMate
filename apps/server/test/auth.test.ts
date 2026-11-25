import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { userSessions, users } from '../src/db/schema.ts'
import { runCleanup } from '../src/jobs/cleanup.ts'
import { refreshCookie, setupTestApp, tokenFromMail, waitForMail } from './helpers.ts'

const t = setupTestApp()
const { app, db, mails } = t
beforeEach(() => t.reset())
afterAll(() => t.close())

const ALICE = { username: 'Alice_01', email: 'Alice@Example.com', password: 'daymate-pass-1', agree: true }

async function register(body: object = ALICE) {
  return app.inject({ method: 'POST', url: '/api/auth/register', payload: body })
}
async function login(account: string, password = ALICE.password, extra: object = {}) {
  return app.inject({ method: 'POST', url: '/api/auth/login', payload: { account, password, ...extra } })
}
const bearer = (token: string) => ({ authorization: `Bearer ${token}` })
async function me(token: string) {
  return app.inject({ url: '/api/me', headers: bearer(token) })
}
async function refresh(cookieValue: string) {
  return app.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { dm_rt: cookieValue } })
}

describe('注册', () => {
  it('成功后直接登录：返回访问令牌，刷新令牌放在 HttpOnly Cookie，发验证邮件', async () => {
    const res = await register()
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.user).toMatchObject({ username: 'Alice_01', email: 'alice@example.com', emailVerified: false })
    expect(body.refreshToken).toBeUndefined()
    const c = refreshCookie(res)!
    expect(c).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/api/auth' })
    expect((await me(body.accessToken)).json().username).toBe('Alice_01')
    const mail = await waitForMail(mails)
    expect(mail?.to).toBe('alice@example.com')
    expect(mail?.text).toContain('https://daymate.test/verify-email?token=')
  })

  it('用户名不区分大小写查重，邮箱查重', async () => {
    await register()
    const r1 = await register({ ...ALICE, username: 'alice_01', email: 'b@example.com' })
    expect(r1.statusCode).toBe(409)
    expect(r1.json().code).toBe('USERNAME_TAKEN')
    const r2 = await register({ ...ALICE, username: 'Bob_02', email: 'ALICE@example.com' })
    expect(r2.json().code).toBe('EMAIL_TAKEN')
  })

  it.each([
    [{ ...ALICE, password: '12345678' }, '太常见'],
    [{ ...ALICE, password: 'alice_01' }, '用户名相同'],
    [{ ...ALICE, password: 'short' }, '至少 8 位'],
    [{ ...ALICE, username: '1abc' }, '字母开头'],
    [{ ...ALICE, email: 'not-email' }, '邮箱格式'],
    [{ ...ALICE, agree: false }, '同意用户协议'],
  ])('校验不通过返回中文提示 %#', async (body, msg) => {
    const res = await register(body)
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain(msg)
  })
})

describe('登录', () => {
  beforeEach(async () => {
    await register()
  })

  it('用户名（不分大小写）或邮箱都能登录', async () => {
    expect((await login('ALICE_01')).statusCode).toBe(200)
    expect((await login('alice@EXAMPLE.com')).statusCode).toBe(200)
  })

  it('密码错和账号不存在的提示一样', async () => {
    const wrong = await login('Alice_01', 'wrong-password')
    const missing = await login('nobody', 'wrong-password')
    expect(wrong.statusCode).toBe(401)
    expect(missing.json()).toEqual(wrong.json())
  })

  it('连续输错 5 次锁 15 分钟，期间密码对也不行；成功登录清零', async () => {
    for (let i = 0; i < 5; i++) expect((await login('Alice_01', 'wrong-password')).statusCode).toBe(401)
    const locked = await login('Alice_01')
    expect(locked.statusCode).toBe(429)
    expect(locked.json().code).toBe('ACCOUNT_LOCKED')
    await db.update(users).set({ lockedUntil: new Date(Date.now() - 1000) })
    expect((await login('Alice_01')).statusCode).toBe(200)
    const [u] = await db.select().from(users)
    expect(u).toMatchObject({ failedLogins: 0, lockedUntil: null })
  })

  it('App 登录把刷新令牌放在响应体里，并能用它刷新', async () => {
    const res = await login('Alice_01', ALICE.password, { client: 'app' })
    const { refreshToken } = res.json()
    expect(refreshCookie(res)).toBeUndefined()
    const r = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken } })
    expect(r.statusCode).toBe(200)
    expect(r.json().refreshToken).not.toBe(refreshToken)
  })

  it('停用的账号不能登录', async () => {
    await db.update(users).set({ status: 'disabled' })
    expect((await login('Alice_01')).json().code).toBe('ACCOUNT_DISABLED')
  })
})

describe('刷新与退出', () => {
  it('每次刷新都换新令牌；旧令牌刚换掉时让重试，过了窗口再用就作废整个会话', async () => {
    const first = refreshCookie(await register())!.value
    const r1 = await refresh(first)
    expect(r1.statusCode).toBe(200)
    const second = refreshCookie(r1)!.value
    expect(second).not.toBe(first)

    // 多标签页并发：刚换掉的旧令牌 → 409 重试，不作废
    expect((await refresh(first)).json().code).toBe('REFRESH_RACE')
    expect((await refresh(second)).statusCode).toBe(200)

    // 超过并发窗口再用旧令牌 = 可能被盗 → 整个会话作废
    await db.update(userSessions).set({ rotatedAt: new Date(Date.now() - 60_000) })
    const r3 = await refresh(second)
    expect(r3.json().code).toBe('SESSION_REVOKED')
    expect(refreshCookie(r3)?.value).toBe('')
  })

  it('退出后刷新令牌和访问令牌都立即失效', async () => {
    const res = await register()
    const token = res.json().accessToken
    const cookie = refreshCookie(res)!.value
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', cookies: { dm_rt: cookie } })
    expect(out.statusCode).toBe(204)
    expect((await refresh(cookie)).statusCode).toBe(401)
    expect((await me(token)).statusCode).toBe(401)
  })

  it('没带令牌或令牌乱写都是 401', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/auth/refresh' })).statusCode).toBe(401)
    expect((await refresh('garbage')).statusCode).toBe(401)
    expect((await app.inject({ url: '/api/me' })).statusCode).toBe(401)
  })
})

describe('邮箱验证', () => {
  it('点链接验证成功，链接只能用一次', async () => {
    const token = (await register()).json().accessToken
    const t1 = tokenFromMail(await waitForMail(mails))
    const ok = await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { token: t1 } })
    expect(ok.statusCode).toBe(200)
    expect((await me(token)).json().emailVerified).toBe(true)
    const again = await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { token: t1 } })
    expect(again.json().code).toBe('TOKEN_INVALID')
  })

  it('重发有 1 分钟冷却；新邮件发出后旧链接作废', async () => {
    const token = (await register()).json().accessToken
    const old = tokenFromMail(await waitForMail(mails))
    const resend = () => app.inject({ method: 'POST', url: '/api/auth/resend-verification', headers: bearer(token) })
    expect((await resend()).json().code).toBe('TOO_FREQUENT')
    await db.execute(sql`update email_tokens set created_at = now() - interval '2 minutes'`)
    expect((await resend()).statusCode).toBe(200)
    const fresh = tokenFromMail(mails[1])
    expect((await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { token: old } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { token: fresh } })).statusCode).toBe(200)
  })
})

describe('找回密码', () => {
  it('不存在的邮箱也返回成功，但不发邮件', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'ghost@example.com' } })
    expect(res.statusCode).toBe(200)
    await new Promise((r) => setTimeout(r, 50))
    expect(mails).toHaveLength(0)
  })

  it('重置后新密码能登录、旧会话全部失效、邮箱视为已验证、链接只能用一次', async () => {
    const reg = await register()
    const oldCookie = refreshCookie(reg)!.value
    await waitForMail(mails)
    await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'ALICE@example.com' } })
    const resetToken = tokenFromMail(await waitForMail(mails, 2))
    expect(mails[1]!.text).toContain('/reset-password?token=')

    const payload = { token: resetToken, password: 'brand-new-pass-9' }
    expect((await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload })).json().code).toBe('TOKEN_INVALID')
    expect((await refresh(oldCookie)).statusCode).toBe(401)
    expect((await login('Alice_01')).statusCode).toBe(401)
    const ok = await login('Alice_01', 'brand-new-pass-9')
    expect(ok.json().user.emailVerified).toBe(true)
  })
})

describe('我的账号', () => {
  it('改资料：昵称、时区（不认识的时区报错）', async () => {
    const token = (await register()).json().accessToken
    const ok = await app.inject({ method: 'PATCH', url: '/api/me', headers: bearer(token), payload: { nickname: '小爱', timezone: 'Asia/Tokyo' } })
    expect(ok.json()).toMatchObject({ nickname: '小爱', timezone: 'Asia/Tokyo' })
    const bad = await app.inject({ method: 'PATCH', url: '/api/me', headers: bearer(token), payload: { timezone: 'Mars/Base' } })
    expect(bad.statusCode).toBe(400)
  })

  it('改密码：当前设备保留，其他设备退出', async () => {
    const a = (await register()).json().accessToken
    const b = (await login('Alice_01')).json().accessToken
    const change = (currentPassword: string) =>
      app.inject({ method: 'PUT', url: '/api/me/password', headers: bearer(a), payload: { currentPassword, newPassword: 'another-pass-77' } })
    expect((await change('wrong')).json().code).toBe('WRONG_PASSWORD')
    expect((await change(ALICE.password)).statusCode).toBe(200)
    expect((await me(a)).statusCode).toBe(200)
    expect((await me(b)).statusCode).toBe(401)
  })

  it('登录设备列表：当前设备排第一，可以踢掉别的设备，别人的设备删不了', async () => {
    const a = (await register()).json().accessToken
    const b = (await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'user-agent': 'iPhone' }, payload: { account: 'Alice_01', password: ALICE.password } })).json().accessToken
    const list = (await app.inject({ url: '/api/me/sessions', headers: bearer(a) })).json()
    expect(list).toHaveLength(2)
    expect(list[0].current).toBe(true)
    const other = list.find((s: { current: boolean }) => !s.current)
    expect(other.userAgent).toBe('iPhone')

    const bob = (await register({ username: 'Bob_02', email: 'bob@example.com', password: 'bob-pass-123', agree: true })).json().accessToken
    expect((await app.inject({ method: 'DELETE', url: `/api/me/sessions/${other.id}`, headers: bearer(bob) })).statusCode).toBe(404)

    expect((await app.inject({ method: 'DELETE', url: `/api/me/sessions/${other.id}`, headers: bearer(a) })).statusCode).toBe(204)
    expect((await me(b)).statusCode).toBe(401)
  })

  it('注销：冷静期内重新登录可撤销；过了 7 天彻底删除', async () => {
    const token = (await register()).json().accessToken
    const del = (password: string) => app.inject({ method: 'DELETE', url: '/api/me', headers: bearer(token), payload: { password } })
    expect((await del('wrong')).json().code).toBe('WRONG_PASSWORD')
    const res = await del(ALICE.password)
    expect(res.json().pendingDeletion.purgeAt).toBeTruthy()
    expect((await me(token)).statusCode).toBe(401)

    const again = (await login('Alice_01')).json()
    expect(again.user.pendingDeletion).not.toBeNull()
    const cancel = await app.inject({ method: 'POST', url: '/api/me/cancel-deletion', headers: bearer(again.accessToken) })
    expect(cancel.json().pendingDeletion).toBeNull()

    await app.inject({ method: 'DELETE', url: '/api/me', headers: bearer(again.accessToken), payload: { password: ALICE.password } })
    expect((await runCleanup(db, new Date(Date.now() + 6 * 86400_000))).purgedUsers).toBe(0)
    expect((await runCleanup(db, new Date(Date.now() + 8 * 86400_000))).purgedUsers).toBe(1)
    expect(await db.select().from(userSessions)).toHaveLength(0)
    expect(await db.select().from(users).where(eq(users.username, 'Alice_01'))).toHaveLength(0)
  })
})
