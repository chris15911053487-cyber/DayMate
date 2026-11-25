import { and, eq, gt, isNull, ne } from 'drizzle-orm'
import type { Db } from '../../db/client.ts'
import { userSessions } from '../../db/schema.ts'
import { HttpError } from '../../lib/http-error.ts'
import { randomToken, sha256 } from '../../lib/secrets.ts'

export const ACCESS_TTL_SEC = 30 * 60
export const REFRESH_TTL_MS = 30 * 86400_000
/** 多个标签页同时刷新时，晚到的那个拿着刚换掉的旧令牌；这段时间内不当成泄露 */
const RACE_WINDOW_MS = 30_000

/** 刷新令牌格式：<会话 id>.<随机串>；库里只存随机串的哈希 */
const compose = (sessionId: string, secret: string) => `${sessionId}.${secret}`
function split(token: string) {
  const i = token.indexOf('.')
  if (i <= 0) return null
  const id = token.slice(0, i)
  return /^[0-9a-f-]{36}$/.test(id) ? { id, secret: token.slice(i + 1) } : null
}

export async function createSession(db: Db, userId: string, meta: { userAgent?: string; ip?: string }) {
  const secret = randomToken()
  const [s] = await db
    .insert(userSessions)
    .values({
      userId,
      refreshHash: sha256(secret),
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      ip: meta.ip ?? null,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    })
    .returning({ id: userSessions.id })
  return { sessionId: s!.id, refreshToken: compose(s!.id, secret) }
}

/**
 * 用刷新令牌换新令牌（每次都换）。已换掉的旧令牌被再次使用 = 可能泄露，作废整个会话；
 * 但刚换掉不久的（多标签页并发）只让客户端重试。
 */
export async function rotateSession(db: Db, token: string, meta: { ip?: string }) {
  const parts = split(token)
  if (!parts) throw new HttpError(401, 'SESSION_INVALID', '登录已失效，请重新登录')
  const hash = sha256(parts.secret)

  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(userSessions).where(eq(userSessions.id, parts.id)).for('update')
    if (!s || s.revokedAt || s.expiresAt.getTime() <= Date.now()) {
      throw new HttpError(401, 'SESSION_INVALID', '登录已失效，请重新登录')
    }
    if (s.refreshHash !== hash) {
      if (s.prevRefreshHash === hash && s.rotatedAt && Date.now() - s.rotatedAt.getTime() < RACE_WINDOW_MS) {
        throw new HttpError(409, 'REFRESH_RACE', '请重试')
      }
      await tx.update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.id, s.id))
      throw new HttpError(401, 'SESSION_REVOKED', '登录状态异常，为了安全请重新登录')
    }
    const secret = randomToken()
    const now = new Date()
    await tx
      .update(userSessions)
      .set({
        prevRefreshHash: s.refreshHash,
        refreshHash: sha256(secret),
        rotatedAt: now,
        lastUsedAt: now,
        ip: meta.ip ?? s.ip,
        expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
      })
      .where(eq(userSessions.id, s.id))
    return { sessionId: s.id, userId: s.userId, refreshToken: compose(s.id, secret) }
  })
}

/** 按刷新令牌作废（退出登录）；令牌不对就什么也不做 */
export async function revokeByToken(db: Db, token: string) {
  const parts = split(token)
  if (!parts) return
  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(userSessions.id, parts.id), eq(userSessions.refreshHash, sha256(parts.secret)), isNull(userSessions.revokedAt)))
}

export async function revokeSession(db: Db, userId: string, sessionId: string) {
  const r = await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(userSessions.id, sessionId), eq(userSessions.userId, userId), isNull(userSessions.revokedAt)))
    .returning({ id: userSessions.id })
  return r.length > 0
}

/** 作废用户的全部会话；exceptSessionId 用于"改密码后保留当前设备" */
export async function revokeAllSessions(db: Db, userId: string, exceptSessionId?: string) {
  const where = exceptSessionId
    ? and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt), ne(userSessions.id, exceptSessionId))
    : and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt))
  await db.update(userSessions).set({ revokedAt: new Date() }).where(where)
}

export async function activeSession(db: Db, sessionId: string) {
  const [s] = await db
    .select({ id: userSessions.id, userId: userSessions.userId })
    .from(userSessions)
    .where(and(eq(userSessions.id, sessionId), isNull(userSessions.revokedAt), gt(userSessions.expiresAt, new Date())))
    .limit(1)
  return s
}

export async function listSessions(db: Db, userId: string) {
  return db
    .select()
    .from(userSessions)
    .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt), gt(userSessions.expiresAt, new Date())))
    .orderBy(userSessions.lastUsedAt)
}
