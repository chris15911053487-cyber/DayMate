import { and, desc, eq, isNull, lt } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { pushSubscriptionSchema, settingsPatchSchema, todayKey, type NotificationPage } from '@daymate/shared'
import { z } from 'zod'
import { notifications, pushSubscriptions } from '../../db/schema.ts'
import { HttpError } from '../../lib/http-error.ts'
import { assertId } from '../../lib/ids.ts'
import { consumeQuota } from '../../lib/quota.ts'
import { parse } from '../../lib/validate.ts'
import { userTimezone } from '../auth/users.ts'
import { generateBrief } from '../briefs/generate.ts'
import { getSettings, saveSettings } from '../settings/repo.ts'
import { notify, unreadCount } from './notify.ts'

const PAGE_SIZE = 30

export async function notifyRoutes(app: FastifyInstance) {
  const { db, push, mailer, publicBaseUrl, llm, quota } = app.deps
  app.addHook('preHandler', app.authenticate)
  const uid = (req: { auth?: { userId: string } }) => req.auth!.userId

  // ---- 设置 ----
  app.get('/me/settings', async (req) => getSettings(db, uid(req)))
  app.put('/me/settings', async (req) => saveSettings(db, uid(req), parse(settingsPatchSchema, req.body)))

  // ---- 站内消息 ----
  app.get('/notifications', async (req): Promise<NotificationPage> => {
    const { before } = parse(z.object({ before: z.iso.datetime().optional() }), req.query)
    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, uid(req)), before ? lt(notifications.createdAt, new Date(before)) : undefined))
      .orderBy(desc(notifications.createdAt))
      .limit(PAGE_SIZE + 1)
    const page = rows.slice(0, PAGE_SIZE)
    return {
      items: page.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, createdAt: n.createdAt.toISOString(), readAt: n.readAt?.toISOString() ?? null })),
      unread: await unreadCount(db, uid(req)),
      next: rows.length > PAGE_SIZE ? page.at(-1)!.createdAt.toISOString() : null,
    }
  })

  app.get('/notifications/unread-count', async (req) => ({ unread: await unreadCount(db, uid(req)) }))

  app.post<{ Params: { id: string } }>('/notifications/:id/read', async (req) => {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, assertId(req.params.id, '消息')), eq(notifications.userId, uid(req)), isNull(notifications.readAt)))
    return { unread: await unreadCount(db, uid(req)) }
  })

  app.post('/notifications/read-all', async (req) => {
    await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, uid(req)), isNull(notifications.readAt)))
    return { unread: 0 }
  })

  // ---- 浏览器推送 ----
  app.get('/push/config', async () => ({ enabled: !!push, publicKey: push?.publicKey ?? null }))

  /** 同一个浏览器重复订阅只更新，换了账号登录就归新账号 */
  app.post('/push/subscriptions', async (req, reply) => {
    if (!push) throw new HttpError(503, 'PUSH_DISABLED', '服务器还没配置推送')
    const sub = parse(pushSubscriptionSchema, req.body)
    const values = { userId: uid(req), endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: req.headers['user-agent']?.slice(0, 300) ?? null, failedCount: 0 }
    await db.insert(pushSubscriptions).values(values).onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values })
    return reply.code(201).send({ ok: true })
  })

  app.delete('/push/subscriptions', async (req, reply) => {
    const { endpoint } = parse(z.object({ endpoint: z.string().max(1000) }), req.body)
    await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, uid(req))))
    return reply.code(204).send()
  })

  /** 发一条测试通知，看看各渠道能不能收到 */
  app.post('/push/test', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const n = await notify({ db, push, mailer, publicBaseUrl, log: req.log }, { userId: uid(req), kind: 'system', title: '测试通知', body: '收到这条，说明这台设备能收到 DayMate 的提醒。', link: '/inbox' })
    return { id: n.id }
  })

  // ---- 早报 / 复盘 ----
  /** 手动生成（不推送，只返回）；算一次 AI 额度 */
  app.post('/briefs/generate', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { kind } = parse(z.object({ kind: z.enum(['morning', 'evening']) }), req.body)
    const tz = await userTimezone(db, uid(req))
    if (llm?.enabled) await consumeQuota(db, uid(req), tz, 'ai', quota.aiPerDay)
    return generateBrief({ db, llm }, { userId: uid(req), tz, kind, date: todayKey(tz) })
  })
}
