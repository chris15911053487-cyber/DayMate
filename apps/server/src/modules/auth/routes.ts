import { eq, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  forgotPasswordSchema,
  loginSchema,
  passwordProblem,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  type AuthResult,
} from '@daymate/shared'
import { users } from '../../db/schema.ts'
import { HttpError } from '../../lib/http-error.ts'
import { resetPasswordMail, verifyEmailMail } from '../../lib/mailer.ts'
import { burnPasswordCheck, hashPassword, verifyPassword } from '../../lib/secrets.ts'
import { parse } from '../../lib/validate.ts'
import { consumeEmailToken, issueEmailToken, lastIssuedAt } from './email-tokens.ts'
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH, signAccessToken } from './plugin.ts'
import {
  ACCESS_TTL_SEC,
  REFRESH_TTL_MS,
  createSession,
  revokeAllSessions,
  revokeByToken,
  rotateSession,
} from './sessions.ts'
import { findUserByAccount, findUserById, toMe, type UserRow } from './users.ts'

const MAX_FAILED_LOGINS = 5
const LOCK_MS = 15 * 60_000
const RESEND_COOLDOWN_MS = 60_000

const limit = (max: number, timeWindow: string) => ({ config: { rateLimit: { max, timeWindow } } })

export async function authRoutes(app: FastifyInstance) {
  const { db, mailer, publicBaseUrl, cookieSecure } = app.deps

  function setRefreshCookie(reply: FastifyReply, token: string) {
    reply.setCookie(REFRESH_COOKIE, token, {
      path: REFRESH_COOKIE_PATH,
      httpOnly: true,
      secure: cookieSecure,
      sameSite: 'strict',
      maxAge: REFRESH_TTL_MS / 1000,
    })
  }
  const clearRefreshCookie = (reply: FastifyReply) =>
    reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH, httpOnly: true, secure: cookieSecure, sameSite: 'strict' })

  async function startSession(req: FastifyRequest, reply: FastifyReply, user: UserRow, client?: 'web' | 'app') {
    const { sessionId, refreshToken } = await createSession(db, user.id, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    })
    const result: AuthResult = {
      accessToken: signAccessToken(app, user.id, sessionId),
      expiresIn: ACCESS_TTL_SEC,
      user: toMe(user),
    }
    if (client === 'app') result.refreshToken = refreshToken
    else setRefreshCookie(reply, refreshToken)
    return result
  }

  async function sendVerifyMail(user: UserRow) {
    const token = await issueEmailToken(db, user.id, 'verify')
    const url = `${publicBaseUrl}/verify-email?token=${token}`
    await mailer.send(verifyEmailMail(user.email, user.nickname || user.username, url))
  }

  app.post('/auth/register', limit(5, '1 hour'), async (req, reply) => {
    const input = parse(registerSchema, req.body)
    const [dupName] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.username}) = lower(${input.username})`)
      .limit(1)
    if (dupName) throw new HttpError(409, 'USERNAME_TAKEN', '这个用户名已经被用了，换一个吧')
    const [dupEmail] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1)
    if (dupEmail) throw new HttpError(409, 'EMAIL_TAKEN', '这个邮箱已经注册过了，可以直接登录或找回密码')

    let user: UserRow
    try {
      ;[user] = (await db
        .insert(users)
        .values({ username: input.username, email: input.email, passwordHash: await hashPassword(input.password) })
        .returning()) as [UserRow]
    } catch (err) {
      // 两个人同时注册同一个名字：唯一索引兜底
      if ((err as { code?: string }).code === '23505') throw new HttpError(409, 'ACCOUNT_TAKEN', '用户名或邮箱已经被注册了')
      throw err
    }
    sendVerifyMail(user).catch((err) => req.log.error({ err }, '发送验证邮件失败'))
    reply.code(201)
    return startSession(req, reply, user)
  })

  app.post('/auth/login', limit(10, '1 minute'), async (req, reply) => {
    const input = parse(loginSchema, req.body)
    const user = await findUserByAccount(db, input.account)
    if (!user) {
      await burnPasswordCheck(input.password)
      throw new HttpError(401, 'INVALID_CREDENTIALS', '账号或密码错误')
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000)
      throw new HttpError(429, 'ACCOUNT_LOCKED', `密码输错次数太多，请 ${minutes} 分钟后再试，或者找回密码`)
    }
    if (user.status === 'disabled') throw new HttpError(403, 'ACCOUNT_DISABLED', '这个账号已被停用')

    if (!(await verifyPassword(user.passwordHash, input.password))) {
      const failed = user.failedLogins + 1
      const locked = failed >= MAX_FAILED_LOGINS
      await db
        .update(users)
        .set(locked ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MS) } : { failedLogins: failed })
        .where(eq(users.id, user.id))
      throw new HttpError(401, 'INVALID_CREDENTIALS', '账号或密码错误')
    }
    if (user.failedLogins > 0 || user.lockedUntil) {
      await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, user.id))
    }
    return startSession(req, reply, user, input.client)
  })

  /** 换新的访问令牌。网页从 Cookie 取刷新令牌；App 放在请求体里 */
  app.post('/auth/refresh', limit(60, '1 minute'), async (req, reply) => {
    const body = parse(refreshSchema, req.body)
    const fromBody = body?.refreshToken
    const token = fromBody ?? req.cookies[REFRESH_COOKIE]
    if (!token) throw new HttpError(401, 'SESSION_INVALID', '请先登录')
    let rotated
    try {
      rotated = await rotateSession(db, token, { ip: req.ip })
    } catch (err) {
      if (err instanceof HttpError && err.statusCode === 401 && !fromBody) clearRefreshCookie(reply)
      throw err
    }
    const user = await findUserById(db, rotated.userId)
    if (!user || user.status === 'disabled') throw new HttpError(403, 'ACCOUNT_DISABLED', '这个账号已被停用')
    const result: AuthResult = {
      accessToken: signAccessToken(app, user.id, rotated.sessionId),
      expiresIn: ACCESS_TTL_SEC,
      user: toMe(user),
    }
    if (fromBody) result.refreshToken = rotated.refreshToken
    else setRefreshCookie(reply, rotated.refreshToken)
    return result
  })

  app.post('/auth/logout', async (req, reply) => {
    const body = parse(refreshSchema, req.body)
    const token = body?.refreshToken ?? req.cookies[REFRESH_COOKIE]
    if (token) await revokeByToken(db, token)
    clearRefreshCookie(reply)
    return reply.code(204).send()
  })

  app.post('/auth/verify-email', limit(20, '1 hour'), async (req) => {
    const { token } = parse(verifyEmailSchema, req.body)
    const userId = await consumeEmailToken(db, token, 'verify')
    if (!userId) throw new HttpError(400, 'TOKEN_INVALID', '验证链接无效或已过期，请在"我的"页面重新发送')
    await db
      .update(users)
      .set({ emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())`, updatedAt: new Date() })
      .where(eq(users.id, userId))
    return { ok: true }
  })

  app.post('/auth/resend-verification', { ...limit(5, '1 hour'), preHandler: app.authenticate }, async (req) => {
    const user = await findUserById(db, req.auth!.userId)
    if (!user) throw new HttpError(401, 'SESSION_INVALID', '请先登录')
    if (user.emailVerifiedAt) throw new HttpError(400, 'ALREADY_VERIFIED', '邮箱已经验证过了')
    const last = await lastIssuedAt(db, user.id, 'verify')
    if (last && Date.now() - last.getTime() < RESEND_COOLDOWN_MS) {
      throw new HttpError(429, 'TOO_FREQUENT', '刚发过一封，请 1 分钟后再试')
    }
    await sendVerifyMail(user)
    return { ok: true }
  })

  /** 不管邮箱是否注册都返回成功，防止被用来探测账号 */
  app.post('/auth/forgot-password', limit(5, '1 hour'), async (req) => {
    const { email } = parse(forgotPasswordSchema, req.body)
    const user = await findUserByAccount(db, email)
    if (user && user.status !== 'disabled') {
      const last = await lastIssuedAt(db, user.id, 'reset')
      if (!last || Date.now() - last.getTime() >= RESEND_COOLDOWN_MS) {
        const token = await issueEmailToken(db, user.id, 'reset')
        const url = `${publicBaseUrl}/reset-password?token=${token}`
        mailer
          .send(resetPasswordMail(user.email, user.nickname || user.username, url))
          .catch((err) => req.log.error({ err }, '发送重置密码邮件失败'))
      }
    }
    return { ok: true }
  })

  /** 重置成功：顺便视为邮箱已验证（能收到邮件就证明邮箱是他的），并让所有设备重新登录 */
  app.post('/auth/reset-password', limit(10, '1 hour'), async (req) => {
    const { token, password } = parse(resetPasswordSchema, req.body)
    const userId = await consumeEmailToken(db, token, 'reset')
    if (!userId) throw new HttpError(400, 'TOKEN_INVALID', '重置链接无效或已过期，请重新申请')
    const user = await findUserById(db, userId)
    if (!user) throw new HttpError(400, 'TOKEN_INVALID', '重置链接无效或已过期，请重新申请')
    const problem = passwordProblem(password, user)
    if (problem) throw new HttpError(400, 'VALIDATION', problem)
    await db
      .update(users)
      .set({
        passwordHash: await hashPassword(password),
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        failedLogins: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
    await revokeAllSessions(db, user.id)
    return { ok: true }
  })
}
