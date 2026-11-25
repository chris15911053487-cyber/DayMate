import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import {
  changePasswordSchema,
  deleteAccountSchema,
  passwordProblem,
  updateMeSchema,
  type SessionInfo,
} from '@daymate/shared'
import { users } from '../../db/schema.ts'
import { HttpError } from '../../lib/http-error.ts'
import { hashPassword, verifyPassword } from '../../lib/secrets.ts'
import { parse } from '../../lib/validate.ts'
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH } from '../auth/plugin.ts'
import { listSessions, revokeAllSessions, revokeSession } from '../auth/sessions.ts'
import { findUserById, toMe } from '../auth/users.ts'

export async function meRoutes(app: FastifyInstance) {
  const { db, cookieSecure } = app.deps
  app.addHook('preHandler', app.authenticate)

  async function currentUser(userId: string) {
    const u = await findUserById(db, userId)
    if (!u) throw new HttpError(401, 'SESSION_INVALID', '请先登录')
    return u
  }

  app.get('/me', async (req) => toMe(await currentUser(req.auth!.userId)))

  app.patch('/me', async (req) => {
    const input = parse(updateMeSchema, req.body)
    const [u] = await db
      .update(users)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(users.id, req.auth!.userId))
      .returning()
    return toMe(u!)
  })

  /** 改密码：保留当前设备，其他设备都要重新登录 */
  app.put('/me/password', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
    const { currentPassword, newPassword } = parse(changePasswordSchema, req.body)
    const u = await currentUser(req.auth!.userId)
    if (!(await verifyPassword(u.passwordHash, currentPassword))) {
      throw new HttpError(400, 'WRONG_PASSWORD', '当前密码不对')
    }
    if (currentPassword === newPassword) throw new HttpError(400, 'VALIDATION', '新密码不能和当前密码一样')
    const problem = passwordProblem(newPassword, u)
    if (problem) throw new HttpError(400, 'VALIDATION', problem)
    await db.update(users).set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() }).where(eq(users.id, u.id))
    await revokeAllSessions(db, u.id, req.auth!.sessionId)
    return { ok: true }
  })

  app.get('/me/sessions', async (req): Promise<SessionInfo[]> => {
    const rows = await listSessions(db, req.auth!.userId)
    return rows
      .map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        ip: s.ip,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt.toISOString(),
        current: s.id === req.auth!.sessionId,
      }))
      .sort((a, b) => Number(b.current) - Number(a.current) || b.lastUsedAt.localeCompare(a.lastUsedAt))
  })

  app.delete<{ Params: { id: string } }>('/me/sessions/:id', async (req, reply) => {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) throw new HttpError(404, 'NOT_FOUND', '找不到这个设备')
    const ok = await revokeSession(db, req.auth!.userId, req.params.id)
    if (!ok) throw new HttpError(404, 'NOT_FOUND', '找不到这个设备')
    return reply.code(204).send()
  })

  /** 申请注销：进入 7 天冷静期，所有设备退出；冷静期内重新登录可撤销 */
  app.delete('/me', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const { password } = parse(deleteAccountSchema, req.body)
    const u = await currentUser(req.auth!.userId)
    if (!(await verifyPassword(u.passwordHash, password))) throw new HttpError(400, 'WRONG_PASSWORD', '密码不对')
    const [updated] = await db
      .update(users)
      .set({ status: 'deleting', deletionRequestedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, u.id))
      .returning()
    await revokeAllSessions(db, u.id)
    reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH, httpOnly: true, secure: cookieSecure, sameSite: 'strict' })
    return toMe(updated!)
  })

  app.post('/me/cancel-deletion', async (req) => {
    const [u] = await db
      .update(users)
      .set({ status: 'active', deletionRequestedAt: null, updatedAt: new Date() })
      .where(eq(users.id, req.auth!.userId))
      .returning()
    return toMe(u!)
  })
}
