import { z } from 'zod'
import { dateKeySchema, repeatSchema, timeSchema } from './calendar.ts'

/**
 * 一句话解析的结果（docs/技术方案.md 7.2）。AI 只给"墙上时间"（日期 + 几点），换算由服务端按用户时区做。
 * 同一套结构也是确认卡片的数据：用户在卡片上改完，原样提交给 /assistant/commit。
 */
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional()

export const eventDraftSchema = z.object({
  type: z.literal('event'),
  title: z.string().trim().min(1).max(100),
  date: dateKeySchema,
  startTime: timeSchema.nullable().optional(),
  endTime: timeSchema.nullable().optional(),
  endDate: dateKeySchema.nullable().optional(),
  allDay: z.boolean().optional(),
  location: nullableText(100),
  people: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  /** null / 不填 = 用默认提醒；[] = 不提醒 */
  remindBeforeMin: z.array(z.number().int().min(0).max(10080)).max(3).nullable().optional(),
  repeat: repeatSchema.optional(),
  calendarId: z.uuid().optional(),
})

export const taskDraftSchema = z.object({
  type: z.literal('task'),
  title: z.string().trim().min(1).max(200),
  dueDate: dateKeySchema.nullable().optional(),
  dueTime: timeSchema.nullable().optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
})

export const entryDraftSchema = z.object({
  type: z.literal('entry'),
  content: z.string().trim().min(1).max(5000),
  date: dateKeySchema,
  time: timeSchema.nullable().optional(),
})

export const queryDraftSchema = z.object({
  type: z.literal('query'),
  from: dateKeySchema,
  to: dateKeySchema,
  question: z.string().trim().min(1).max(200),
})

export const draftItemSchema = z.discriminatedUnion('type', [eventDraftSchema, taskDraftSchema, entryDraftSchema, queryDraftSchema])
export type DraftItem = z.infer<typeof draftItemSchema>
export type EventDraft = z.infer<typeof eventDraftSchema>
export type TaskDraft = z.infer<typeof taskDraftSchema>
export type EntryDraft = z.infer<typeof entryDraftSchema>

/** 模型输出的整体结构（服务端校验用） */
export const parseOutputSchema = z.object({
  items: z.array(draftItemSchema).max(10),
  assumptions: z.array(z.string().max(200)).max(10).optional(),
  reply: z.string().max(500).optional(),
})

export const parseRequestSchema = z.object({
  text: z.string().trim().min(1, '没听到内容').max(1000, '一次说的太长了，分几次说吧'),
  inputMode: z.enum(['voice', 'text']).default('text'),
  voiceLogId: z.uuid().nullable().optional(),
})

export interface ConflictInfo {
  title: string
  /** 用户时区的 'HH:mm–HH:mm' 或"全天" */
  time: string
}

/** 解析结果：每张卡片带上冲突提示；提问直接给回答 */
export interface ParseResult {
  items: (DraftItem & { conflicts?: ConflictInfo[] })[]
  assumptions: string[]
  reply: string
  /** 提问的回答（items 里有 query 时） */
  answer: string | null
  /** AI 不可用或输出无法使用时，原话转成记录草稿，fallback = true */
  fallback: boolean
}

export const commitRequestSchema = z.object({
  items: z.array(z.discriminatedUnion('type', [eventDraftSchema, taskDraftSchema, entryDraftSchema])).min(1).max(10),
  inputMode: z.enum(['voice', 'text']).default('text'),
  voiceLogId: z.uuid().nullable().optional(),
  /** 用户最终确认的原话（改过识别结果时与识别文字不同 → 识别错误样本） */
  finalText: z.string().max(1000).nullable().optional(),
})
export type CommitRequest = z.input<typeof commitRequestSchema>

export interface CommitResult {
  created: { type: 'event' | 'task' | 'entry'; id: string; title: string }[]
}

export interface SpeechResult {
  text: string
  voiceLogId: string | null
}
