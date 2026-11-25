import { z } from 'zod'
import type { Repeat } from './recurrence.ts'
import { DATE_KEY_RE, TIME_RE, isDateKey, minutesOf } from './time.ts'

/** 日历本颜色只能选主题语义色，换主题时跟着变 */
export const CALENDAR_COLORS = ['primary', 'accent', 'success', 'warning', 'danger'] as const
export type CalendarColor = (typeof CALENDAR_COLORS)[number]

export const dateKeySchema = z.string().regex(DATE_KEY_RE, '日期格式不对').refine(isDateKey, '没有这一天')
export const timeSchema = z.string().regex(TIME_RE, '时间格式不对')

export const repeatSchema = z
  .object({
    freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    interval: z.number().int().min(1).max(99).optional(),
    byWeekday: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    until: dateKeySchema.nullable().optional(),
    count: z.number().int().min(1).max(999).nullable().optional(),
  })
  .nullable()

export const REMINDER_OPTIONS = [0, 5, 15, 30, 60, 120, 1440] as const

export const eventInputSchema = z
  .object({
    calendarId: z.uuid().optional(),
    title: z.string().trim().min(1, '写个标题吧').max(100, '标题最多 100 个字'),
    notes: z.string().trim().max(2000, '备注最多 2000 个字').nullable().optional(),
    location: z.string().trim().max(100, '地点最多 100 个字').nullable().optional(),
    people: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
    allDay: z.boolean(),
    startDate: dateKeySchema,
    /** 全天日程不填 */
    startTime: timeSchema.nullable().optional(),
    /** 不填 = 和开始同一天 */
    endDate: dateKeySchema.nullable().optional(),
    /** 不填 = 开始后 1 小时 */
    endTime: timeSchema.nullable().optional(),
    repeat: repeatSchema.optional(),
    /** 提前多少分钟提醒，空数组 = 不提醒 */
    remindBeforeMin: z.array(z.number().int().min(0).max(10080)).max(3).optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.allDay && !v.startTime) ctx.addIssue({ code: 'custom', path: ['startTime'], message: '请选开始时间' })
    const endDate = v.endDate ?? v.startDate
    if (endDate < v.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: '结束日期不能早于开始日期' })
    if (!v.allDay && v.startTime && v.endTime && endDate === v.startDate && minutesOf(v.endTime) <= minutesOf(v.startTime)) {
      ctx.addIssue({ code: 'custom', path: ['endTime'], message: '结束时间要晚于开始时间' })
    }
    if (v.repeat?.until && v.repeat.until < v.startDate) {
      ctx.addIssue({ code: 'custom', path: ['repeat'], message: '重复的截止日期不能早于开始日期' })
    }
  })
export type EventInput = z.input<typeof eventInputSchema>

export const calendarInputSchema = z.object({
  name: z.string().trim().min(1, '起个名字').max(20, '名字最多 20 个字'),
  color: z.enum(CALENDAR_COLORS),
})

export const taskInputSchema = z.object({
  title: z.string().trim().min(1, '写点什么吧').max(200, '最多 200 个字'),
  notes: z.string().trim().max(2000).nullable().optional(),
  dueDate: dateKeySchema.nullable().optional(),
  dueTime: timeSchema.nullable().optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
})
export const taskPatchSchema = taskInputSchema.partial().extend({ done: z.boolean().optional() })
export type TaskInput = z.input<typeof taskInputSchema>

export const entryInputSchema = z.object({
  date: dateKeySchema,
  time: timeSchema.nullable().optional(),
  content: z.string().trim().min(1, '写点什么吧').max(5000, '一条记录最多 5000 个字'),
  eventId: z.uuid().nullable().optional(),
  mood: z.number().int().min(1).max(5).nullable().optional(),
})
export const entryPatchSchema = entryInputSchema.partial()
export type EntryInput = z.input<typeof entryInputSchema>

/** 记录里的 #标签：中英文、数字、下划线，最多 10 个 */
export function extractTags(text: string): string[] {
  const tags = new Set<string>()
  for (const m of text.matchAll(/#([\p{L}\p{N}_]{1,20})/gu)) tags.add(m[1]!)
  return [...tags].slice(0, 10)
}

export interface CalendarInfo {
  id: string
  name: string
  color: CalendarColor
  isDefault: boolean
}

export interface EventDetail {
  id: string
  calendarId: string
  title: string
  notes: string | null
  location: string | null
  people: string[]
  allDay: boolean
  /** 带时间的日程：ISO 瞬间 */
  start: string | null
  end: string | null
  /** 全天日程：日期（含结束那天） */
  startDate: string | null
  endDate: string | null
  /** 重复按这个时区的墙上时间展开 */
  timezone: string
  repeat: Repeat | null
  remindBeforeMin: number[]
  source: 'manual' | 'voice' | 'text'
  createdAt: string
  updatedAt: string
}

/** 某段时间里的一次发生（重复日程展开后的每一场） */
export interface Occurrence {
  /** 唯一键：日程 id，重复日程再加 :日期 */
  key: string
  eventId: string
  calendarId: string
  color: CalendarColor
  title: string
  location: string | null
  allDay: boolean
  start: string | null
  end: string | null
  startDate: string | null
  endDate: string | null
  recurring: boolean
}

export interface Task {
  id: string
  title: string
  notes: string | null
  dueDate: string | null
  dueAt: string | null
  priority: 'low' | 'normal' | 'high'
  done: boolean
  doneAt: string | null
  createdAt: string
}

export interface Entry {
  id: string
  date: string
  occurredAt: string | null
  content: string
  tags: string[]
  mood: number | null
  eventId: string | null
  source: 'manual' | 'voice' | 'text'
  createdAt: string
  updatedAt: string
}

export interface TodayData {
  date: string
  timezone: string
  /** 当天的 AI 早报 / 晚间复盘（还没生成为 null） */
  briefs: { morning: import('./notify.ts').DailyBrief | null; evening: import('./notify.ts').DailyBrief | null }
  events: Occurrence[]
  /** 未完成的：逾期 + 今天到期 + 没有截止日期；以及今天完成的 */
  tasks: Task[]
  entries: Entry[]
}

export interface SearchResult {
  events: EventDetail[]
  tasks: Task[]
  entries: Entry[]
}
