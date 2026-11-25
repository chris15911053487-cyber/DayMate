import {
  draftItemSchema,
  minutesOf,
  parseOutputSchema,
  zonedParts,
  type ConflictInfo,
  type DraftItem,
  type EventDraft,
  type ParseResult,
} from '@daymate/shared'
import type { Llm } from '../../ai/llm.ts'
import { ANSWER_SYSTEM_PROMPT, PARSE_SYSTEM_PROMPT, buildParseUserMessage } from './prompt.ts'

export interface ParseDeps {
  llm: Llm
  /** 冲突检测：返回和这条日程时间重叠的已有日程 */
  findConflicts: (draft: EventDraft) => Promise<ConflictInfo[]>
  /** 回答提问用的数据（已格式化成文字） */
  describeRange: (from: string, to: string) => Promise<string>
}

/** 模型常见的小毛病先修一下再校验：15:00:00、9:5、2026/11/25、"null" 字符串 */
export function normalizeItem(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const o: Record<string, unknown> = { ...(raw as Record<string, unknown>) }
  for (const [k, v] of Object.entries(o)) {
    if (v === 'null' || v === '') o[k] = null
    else if (typeof v === 'string' && /Time$|^time$/.test(k)) {
      const m = v.match(/^(\d{1,2}):(\d{1,2})/)
      if (m) o[k] = `${m[1]!.padStart(2, '0')}:${m[2]!.padStart(2, '0')}`
    } else if (typeof v === 'string' && /Date$|^date$|^from$|^to$/.test(k)) {
      const m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
      if (m) o[k] = `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`
    }
  }
  if (o.type === 'event') {
    if (o.allDay === undefined) o.allDay = !o.startTime
    if (o.allDay) {
      o.startTime = null
      o.endTime = null
    }
    if (Array.isArray(o.people)) o.people = o.people.filter((p) => typeof p === 'string' && p.trim())
    if (o.repeat && typeof o.repeat === 'object') {
      const r = { ...(o.repeat as Record<string, unknown>) }
      for (const k of ['interval', 'count', 'until', 'byWeekday']) if (r[k] === null) delete r[k]
      o.repeat = r
    }
    // 结束早于开始且没写结束日期：多半是模型把下午写成了上午，丢掉结束时间用默认时长
    if (typeof o.startTime === 'string' && typeof o.endTime === 'string' && !o.endDate && minutesOf(o.endTime) <= minutesOf(o.startTime)) {
      o.endTime = null
    }
  }
  return o
}

/** 逐项校验：好的留下，坏的丢掉（返回丢掉的原因，用于重试） */
export function validateOutput(raw: unknown): { items: DraftItem[]; assumptions: string[]; reply: string; problems: string[] } {
  const shell = parseOutputSchema.pick({ assumptions: true, reply: true }).safeParse(raw)
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items) ? ((raw as { items: unknown[] }).items) : null
  if (!list) return { items: [], assumptions: [], reply: '', problems: ['缺少 items 数组'] }
  const items: DraftItem[] = []
  const problems: string[] = []
  list.slice(0, 10).forEach((it, i) => {
    const r = draftItemSchema.safeParse(normalizeItem(it))
    if (r.success) items.push(r.data)
    else problems.push(`items[${i}]：${r.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('；')}`)
  })
  return {
    items,
    assumptions: shell.success ? (shell.data.assumptions ?? []) : [],
    reply: shell.success ? (shell.data.reply ?? '') : '',
    problems,
  }
}

function fallbackResult(text: string, now: Date, tz: string, reason: string): ParseResult {
  const p = zonedParts(now, tz)
  return {
    items: [{ type: 'entry', content: text, date: p.date, time: p.time }],
    assumptions: [],
    reply: reason,
    answer: null,
    fallback: true,
  }
}

/**
 * 一句话 → 卡片。模型输出不合格时把问题交回模型重试一次；仍不行或模型不可用，
 * 原话存成一条记录草稿 —— 用户说的话不能丢（docs/技术方案.md 7.4）。
 */
export async function parseUtterance(
  deps: ParseDeps,
  input: { text: string; inputMode: 'voice' | 'text'; userId: string; tz: string; now?: Date; calendars?: string[] },
): Promise<ParseResult> {
  const now = input.now ?? new Date()
  if (!deps.llm.enabled) return fallbackResult(input.text, now, input.tz, 'AI 暂时没开，先记成一条记录，你可以改成日程或待办。')

  const messages = [
    { role: 'system' as const, content: PARSE_SYSTEM_PROMPT },
    { role: 'user' as const, content: buildParseUserMessage(input.text, { now, tz: input.tz, inputMode: input.inputMode, calendars: input.calendars }) },
  ]
  let result: ReturnType<typeof validateOutput> | null = null
  try {
    let raw = await deps.llm.chatJson(messages, { purpose: 'parse', userId: input.userId })
    result = validateOutput(raw)
    if (result.problems.length && result.items.length === 0) {
      raw = await deps.llm.chatJson(
        [
          ...messages,
          { role: 'assistant', content: JSON.stringify(raw) },
          { role: 'user', content: `上面的 json 有问题：${result.problems.join('；')}。按格式要求重新输出完整的 json。` },
        ],
        { purpose: 'parse-retry', userId: input.userId },
      )
      result = validateOutput(raw)
    }
  } catch {
    return fallbackResult(input.text, now, input.tz, 'AI 暂时没响应，先记成一条记录，你可以改成日程或待办。')
  }

  if (!result.items.length) {
    return { ...fallbackResult(input.text, now, input.tz, result.reply || '没太听懂，先记成一条记录，你可以改成日程或待办。') }
  }

  // 提问：查数据后再让模型回答
  let answer: string | null = null
  const query = result.items.find((i) => i.type === 'query')
  if (query && query.type === 'query') {
    try {
      const data = await deps.describeRange(query.from, query.to)
      const raw = (await deps.llm.chatJson(
        [
          { role: 'system', content: ANSWER_SYSTEM_PROMPT },
          { role: 'user', content: `【现在】${zonedParts(now, input.tz).date} ${zonedParts(now, input.tz).time}\n【问题】${query.question}\n【${query.from} 到 ${query.to} 的数据】\n${data}` },
        ],
        { purpose: 'answer', userId: input.userId, maxTokens: 500 },
      )) as { answer?: unknown }
      answer = typeof raw?.answer === 'string' ? raw.answer : null
    } catch {
      answer = null
    }
    if (!answer) answer = `${query.from === query.to ? query.from : `${query.from} 到 ${query.to}`}的安排：\n${await deps.describeRange(query.from, query.to)}`
  }

  const items = await Promise.all(
    result.items.map(async (it) => (it.type === 'event' && !it.allDay && it.startTime ? { ...it, conflicts: await deps.findConflicts(it) } : it)),
  )
  return { items, assumptions: result.assumptions, reply: result.reply, answer, fallback: false }
}

/** 日程草稿 → 日程表单输入（commit 和冲突检测共用） */
export function eventDraftToInput(d: EventDraft, defaultRemind = 15) {
  const allDay = d.allDay ?? !d.startTime
  return {
    title: d.title,
    allDay,
    startDate: d.date,
    startTime: allDay ? null : d.startTime ?? null,
    endDate: d.endDate ?? null,
    endTime: allDay ? null : d.endTime ?? null,
    location: d.location ?? null,
    people: d.people ?? [],
    repeat: d.repeat ?? null,
    remindBeforeMin: d.remindBeforeMin ?? (allDay ? [] : [defaultRemind]),
    calendarId: d.calendarId,
  }
}

