import { sql } from 'drizzle-orm'
import { boolean, date, index, integer, jsonb, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import type { UserSettings } from '@daymate/shared'
import { uuidv7 } from '../lib/uuid.ts'

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}

/** 账号（字段见 docs/技术方案.md 第 5、11 节；登录逻辑在 M1 实现） */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    username: text('username').notNull(),
    /** 统一存小写 */
    email: text('email').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    passwordHash: text('password_hash').notNull(),
    nickname: text('nickname'),
    avatarUrl: text('avatar_url'),
    timezone: text('timezone').notNull().default('Asia/Shanghai'),
    status: text('status', { enum: ['active', 'disabled', 'deleting'] }).notNull().default('active'),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    /** 申请注销的时间；冷静期过后由后台任务彻底删除 */
    deletionRequestedAt: timestamp('deletion_requested_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_username_lower_uq').on(sql`lower(${t.username})`),
    uniqueIndex('users_email_uq').on(t.email),
  ],
)

/** 登录会话：一台设备一行。刷新令牌只存哈希；prev 用来识别"已换掉的旧令牌被再次使用" */
export const userSessions = pgTable(
  'user_sessions',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshHash: text('refresh_hash').notNull(),
    prevRefreshHash: text('prev_refresh_hash'),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('user_sessions_user_idx').on(t.userId)],
)

/** 邮箱验证 / 重置密码的一次性令牌，只存哈希 */
export const emailTokens = pgTable(
  'email_tokens',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose', { enum: ['verify', 'reset'] }).notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('email_tokens_hash_uq').on(t.tokenHash), index('email_tokens_user_idx').on(t.userId)],
)

const owner = () =>
  uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
/** 软删除：30 天内可撤销，之后由清理任务删掉 */
const deletedAt = () => timestamp('deleted_at', { withTimezone: true })
const SOURCES = ['manual', 'voice', 'text'] as const

/** 日历本：每个用户有一个默认的"我的日历"；颜色是主题语义色的名字 */
export const calendars = pgTable(
  'calendars',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    userId: owner(),
    name: text('name').notNull(),
    color: text('color', { enum: ['primary', 'accent', 'success', 'warning', 'danger'] }).notNull().default('primary'),
    isDefault: boolean('is_default').notNull().default(false),
    deletedAt: deletedAt(),
    ...timestamps,
  },
  (t) => [index('calendars_user_idx').on(t.userId)],
)

/**
 * 日程：带时间的用 start_at / end_at（timestamptz）；全天的用 start_date / end_date（含结束那天）。
 * timezone 是创建时用户的时区，重复日程按这个时区的墙上时间展开（docs/技术方案.md 8.2、8.3）。
 */
export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    userId: owner(),
    calendarId: uuid('calendar_id')
      .notNull()
      .references(() => calendars.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    notes: text('notes'),
    location: text('location'),
    people: text('people').array().notNull().default(sql`'{}'::text[]`),
    allDay: boolean('all_day').notNull().default(false),
    startAt: timestamp('start_at', { withTimezone: true }),
    endAt: timestamp('end_at', { withTimezone: true }),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    timezone: text('timezone').notNull(),
    rrule: text('rrule'),
    remindBeforeMin: integer('remind_before_min').array().notNull().default(sql`'{}'::integer[]`),
    source: text('source', { enum: SOURCES }).notNull().default('manual'),
    deletedAt: deletedAt(),
    ...timestamps,
  },
  (t) => [index('events_user_start_idx').on(t.userId, t.startAt), index('events_user_date_idx').on(t.userId, t.startDate)],
)

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    userId: owner(),
    title: text('title').notNull(),
    notes: text('notes'),
    dueDate: date('due_date', { mode: 'string' }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    priority: text('priority', { enum: ['low', 'normal', 'high'] }).notNull().default('normal'),
    doneAt: timestamp('done_at', { withTimezone: true }),
    source: text('source', { enum: SOURCES }).notNull().default('manual'),
    deletedAt: deletedAt(),
    ...timestamps,
  },
  (t) => [index('tasks_user_due_idx').on(t.userId, t.dueDate)],
)

/** 当天记录：按 entry_date 组织；occurred_at 可选；tags 从正文里的 #标签 提取 */
export const entries = pgTable(
  'entries',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    userId: owner(),
    entryDate: date('entry_date', { mode: 'string' }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }),
    content: text('content').notNull(),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    mood: smallint('mood'),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'set null' }),
    source: text('source', { enum: SOURCES }).notNull().default('manual'),
    deletedAt: deletedAt(),
    ...timestamps,
  },
  (t) => [index('entries_user_date_idx').on(t.userId, t.entryDate)],
)

/**
 * 语音识别记录：不存录音，只存文字（docs/技术方案.md 6.2）。
 * final_text 与 recognized_text 不同 = 用户改过 = 识别错误样本，可导出给百度自训练平台。保留 90 天。
 */
export const voiceLogs = pgTable(
  'voice_logs',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    userId: owner(),
    recognizedText: text('recognized_text').notNull(),
    finalText: text('final_text'),
    durationMs: integer('duration_ms'),
    provider: text('provider').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('voice_logs_user_idx').on(t.userId, t.createdAt)],
)

/** AI 调用记录：看成本、排查问题；不存提示词和原话。保留 180 天 */
export const aiCalls = pgTable(
  'ai_calls',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    purpose: text('purpose').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cachedTokens: integer('cached_tokens'),
    latencyMs: integer('latency_ms').notNull(),
    ok: boolean('ok').notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_calls_created_idx').on(t.createdAt)],
)

/** 每人每天的语音、AI 调用次数（按用户时区的日期计） */
export const usageDaily = pgTable(
  'usage_daily',
  {
    userId: owner(),
    day: date('day', { mode: 'string' }).notNull(),
    asrCount: integer('asr_count').notNull().default(0),
    aiCount: integer('ai_count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
)

/** 提醒与推送设置（整份 JSON，字段见 shared 的 UserSettings；没有行 = 全用默认值） */
export const userSettings = pgTable('user_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  data: jsonb('data').$type<UserSettings>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * 待发提醒（调度队列，docs/技术方案.md 9.3）：保存日程 / 待办时写入，重复日程只写下一场，发完再写下一场。
 * status：pending → sending → sent / missed（服务停机超过 30 分钟错过的）/ failed
 */
export const reminders = pgTable(
  'reminders',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    userId: owner(),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    /** 这一场开始的瞬间（待办是截止时间） */
    occurrenceStart: timestamp('occurrence_start', { withTimezone: true }).notNull(),
    remindMin: integer('remind_min').notNull(),
    fireAt: timestamp('fire_at', { withTimezone: true }).notNull(),
    status: text('status', { enum: ['pending', 'sending', 'sent', 'missed', 'failed'] }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('reminders_due_idx').on(t.status, t.fireAt),
    // 同一场、同一个提前量只提醒一次（重排时靠它去重）
    uniqueIndex('reminders_event_uq').on(t.eventId, t.occurrenceStart, t.remindMin),
    uniqueIndex('reminders_task_uq').on(t.taskId, t.occurrenceStart, t.remindMin),
  ],
)

/** 站内消息：所有主动推送都先写这里（打开应用就能看到），再按设置发各渠道 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    userId: owner(),
    kind: text('kind', { enum: ['reminder', 'brief', 'suggestion', 'system'] }).notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    link: text('link'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
)

/** 每条消息在各渠道的发送结果 */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    channel: text('channel', { enum: ['webpush', 'email'] }).notNull(),
    status: text('status', { enum: ['sent', 'failed', 'skipped'] }).notNull(),
    detail: text('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('deliveries_notification_idx').on(t.notificationId)],
)

/** Web Push 订阅：一个浏览器一行；推送服务返回 404/410 时删掉 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    userId: owner(),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    failedCount: integer('failed_count').notNull().default(0),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('push_endpoint_uq').on(t.endpoint), index('push_user_idx').on(t.userId)],
)

/** AI 早报 / 晚间复盘：每人每天每种一份 */
export const dailyBriefs = pgTable(
  'daily_briefs',
  {
    id: uuid('id').primaryKey().$defaultFn(() => uuidv7()),
    userId: owner(),
    briefDate: date('brief_date', { mode: 'string' }).notNull(),
    kind: text('kind', { enum: ['morning', 'evening'] }).notNull(),
    summary: text('summary').notNull(),
    suggestions: jsonb('suggestions').$type<string[]>().notNull().default([]),
    model: text('model').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('daily_briefs_uq').on(t.userId, t.briefDate, t.kind)],
)
