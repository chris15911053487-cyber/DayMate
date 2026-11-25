import { and, eq, sql } from 'drizzle-orm'
import { zonedParts, type NotificationKind, type PushPayload } from '@daymate/shared'
import type { Db } from '../../db/client.ts'
import { notificationDeliveries, notifications, pushSubscriptions, users } from '../../db/schema.ts'
import { notificationMail, type Mailer } from '../../lib/mailer.ts'
import type { PushSender } from '../../push/index.ts'
import { getSettings, inQuietHours } from '../settings/repo.ts'

export interface NotifyDeps {
  db: Db
  mailer: Mailer
  push?: PushSender | null
  publicBaseUrl: string
  log?: { warn: (o: object, m: string) => void }
}

export interface NotifyInput {
  userId: string
  kind: NotificationKind
  title: string
  body?: string
  /** 站内路径，如 /calendar?view=day&date=2026-11-25 */
  link?: string | null
  /** false = 只写站内消息（错过的提醒、手动生成的早报） */
  deliver?: boolean
}

/** 一种消息走哪个设置分组 */
const GROUP = { reminder: 'reminder', brief: 'brief', suggestion: 'brief', system: 'reminder' } as const
/** 推送服务连续失败这么多次就删掉订阅 */
const MAX_PUSH_FAILURES = 5

/**
 * 统一推送出口（docs/技术方案.md 9.1，沿用 online-report notify.js 的思路）：
 * 1. 先写站内消息；2. 按用户设置和免打扰时段发 Web Push、邮件；3. 每个渠道的结果记下来。
 * 新增推送来源只调它，不要各自发。
 */
export async function notify(deps: NotifyDeps, input: NotifyInput, now = new Date()) {
  const { db } = deps
  const [n] = await db
    .insert(notifications)
    .values({ userId: input.userId, kind: input.kind, title: input.title, body: input.body ?? '', link: input.link ?? null })
    .returning()
  if (input.deliver === false) return n!

  const [user] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1)
  if (!user) return n!
  const settings = await getSettings(db, user.id)
  const channels = settings.channels[GROUP[input.kind]]
  // 免打扰只拦早报、复盘、建议；日程提醒照常发
  const quiet = input.kind !== 'reminder' && inQuietHours(settings, zonedParts(now, user.timezone).time)
  const results: { channel: 'webpush' | 'email'; status: 'sent' | 'failed' | 'skipped'; detail?: string }[] = []
  const url = input.link ?? '/inbox'

  if (channels.webpush && !quiet && deps.push) {
    const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id))
    const payload: PushPayload = { title: input.title, body: input.body ?? '', url, tag: `${input.kind}-${n!.id}`, notificationId: n!.id }
    for (const s of subs) {
      const r = await deps.push.send(s, payload)
      if (r.ok) {
        await db.update(pushSubscriptions).set({ failedCount: 0, lastSuccessAt: now }).where(eq(pushSubscriptions.id, s.id))
        results.push({ channel: 'webpush', status: 'sent' })
      } else {
        results.push({ channel: 'webpush', status: 'failed', detail: r.error.slice(0, 300) })
        if (r.gone || s.failedCount + 1 >= MAX_PUSH_FAILURES) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id))
        else await db.update(pushSubscriptions).set({ failedCount: sql`${pushSubscriptions.failedCount} + 1` }).where(eq(pushSubscriptions.id, s.id))
        deps.log?.warn({ err: r.error, subscription: s.id }, 'Web Push 发送失败')
      }
    }
  } else if (channels.webpush) {
    results.push({ channel: 'webpush', status: 'skipped', detail: quiet ? '免打扰时段' : '没有配置推送' })
  }

  if (channels.email) {
    if (quiet || !user.emailVerifiedAt) {
      results.push({ channel: 'email', status: 'skipped', detail: quiet ? '免打扰时段' : '邮箱未验证' })
    } else {
      try {
        await deps.mailer.send(notificationMail(user.email, input.title, input.body ?? '', `${deps.publicBaseUrl}${url}`))
        results.push({ channel: 'email', status: 'sent' })
      } catch (err) {
        results.push({ channel: 'email', status: 'failed', detail: (err as Error).message.slice(0, 300) })
      }
    }
  }

  if (results.length) {
    await db.insert(notificationDeliveries).values(results.map((r) => ({ notificationId: n!.id, channel: r.channel, status: r.status, detail: r.detail ?? null })))
  }
  return n!
}

export async function unreadCount(db: Db, userId: string) {
  const [r] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), sql`${notifications.readAt} is null`))
  return r?.c ?? 0
}
