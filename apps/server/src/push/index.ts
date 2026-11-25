import * as webpush from 'web-push'
import type { PushPayload } from '@daymate/shared'

export interface PushTarget {
  endpoint: string
  p256dh: string
  auth: string
}
export type PushOutcome = { ok: true } | { ok: false; gone: boolean; error: string }

/** 浏览器推送（Web Push + VAPID）。没配密钥时为 null，推送渠道整体跳过 */
export interface PushSender {
  readonly publicKey: string
  send(target: PushTarget, payload: PushPayload): Promise<PushOutcome>
}

export function createWebPush(cfg: { publicKey: string; privateKey: string; subject: string }): PushSender | null {
  if (!cfg.publicKey || !cfg.privateKey) return null
  webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey)
  return {
    publicKey: cfg.publicKey,
    async send(target, payload) {
      try {
        await webpush.sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          JSON.stringify(payload),
          // 提醒过了 1 小时还没送达就不要了；urgency high 让手机在省电模式下也尽快送
          { TTL: 3600, urgency: 'high', timeout: 10_000 },
        )
        return { ok: true }
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        // 404 / 410 = 订阅已失效（用户关了通知、卸载了应用）
        return { ok: false, gone: status === 404 || status === 410, error: `${status ?? ''} ${(err as Error).message}`.trim() }
      }
    },
  }
}
