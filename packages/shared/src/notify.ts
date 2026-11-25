import { z } from 'zod'
import { timeSchema } from './calendar.ts'

/** 消息类型（docs/技术方案.md 9.1） */
export type NotificationKind = 'reminder' | 'brief' | 'suggestion' | 'system'
export type PushChannel = 'webpush' | 'email'

const channelSwitch = z.object({ webpush: z.boolean(), email: z.boolean() })

/** 用户的提醒与推送设置 */
export const settingsSchema = z.object({
  channels: z.object({ reminder: channelSwitch, brief: channelSwitch }),
  morningBrief: z.object({ enabled: z.boolean(), time: timeSchema }),
  eveningReview: z.object({ enabled: z.boolean(), time: timeSchema }),
  /** 免打扰只拦早报、复盘、建议；用户自己设的日程提醒照常发 */
  quietHours: z.object({ enabled: z.boolean(), start: timeSchema, end: timeSchema }),
  defaultRemindMin: z.number().int().min(0).max(10080),
})
export type UserSettings = z.infer<typeof settingsSchema>
/** 部分修改：渠道可以只改其中一组 */
export const settingsPatchSchema = settingsSchema
  .omit({ channels: true })
  .partial()
  .extend({ channels: z.object({ reminder: channelSwitch.partial(), brief: channelSwitch.partial() }).partial().optional() })
export type SettingsPatch = z.infer<typeof settingsPatchSchema>

export const DEFAULT_SETTINGS: UserSettings = {
  channels: { reminder: { webpush: true, email: false }, brief: { webpush: true, email: false } },
  morningBrief: { enabled: true, time: '07:30' },
  eveningReview: { enabled: true, time: '21:30' },
  quietHours: { enabled: true, start: '23:00', end: '07:00' },
  defaultRemindMin: 15,
}

export interface NotificationItem {
  id: string
  kind: NotificationKind
  title: string
  body: string
  link: string | null
  createdAt: string
  readAt: string | null
}

export interface NotificationPage {
  items: NotificationItem[]
  unread: number
  /** 下一页游标（最后一条的 createdAt），没有更多为 null */
  next: string | null
}

export const pushSubscriptionSchema = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(10).max(100) }),
})

export type BriefKind = 'morning' | 'evening'
export interface DailyBrief {
  id: string
  date: string
  kind: BriefKind
  summary: string
  suggestions: string[]
  /** 'rule' = 模型不可用时规则生成 */
  model: string
  createdAt: string
}

/** 推送时带给 Service Worker 的数据 */
export interface PushPayload {
  title: string
  body: string
  url: string
  tag: string
  notificationId: string
}
