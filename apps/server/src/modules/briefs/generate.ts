import { and, eq } from 'drizzle-orm'
import { addDays, splitKey, weekdayLabel, zonedParts, type BriefKind, type DailyBrief, type Occurrence, type Task } from '@daymate/shared'
import { z } from 'zod'
import type { Llm } from '../../ai/llm.ts'
import type { Db } from '../../db/client.ts'
import { dailyBriefs } from '../../db/schema.ts'
import { occurrencesInRange } from '../calendar/repo.ts'
import { entriesBetween } from '../entries/routes.ts'
import { tasksForDay } from '../tasks/routes.ts'

/** 系统提示词固定不变（前缀缓存）；当天数据放用户消息 */
const SYSTEM: Record<BriefKind, string> = {
  morning: `你是日历助手 DayMate，给用户写今天的早报。根据给出的今日日程和待办，输出 json：{"summary":"2-4 句话","suggestions":["最多 3 条具体可做的建议"]}。
要求：
- summary 先说今天最重要的安排和时间，再提醒逾期或今天到期的待办；语气像贴心的助理，简洁，不客套。
- 有时间冲突、日程排得太满（连续好几个小时）、两个安排之间路上时间太紧时要指出来。
- suggestions 要具体（比如"上午 10 点前先花 30 分钟写报告提纲"），不要空话；没什么可建议的就给空数组。
- 只根据给出的数据，不要编造日程；时间用 24 小时制。没有任何安排时，鼓励用户安排一下今天。
- 注意【现在】的时间：已经过去的时段不要再建议，只安排现在之后的事。`,
  evening: `你是日历助手 DayMate，给用户写今天的晚间复盘。根据给出的今天日程、待办完成情况、当天记录和明天的安排，输出 json：{"summary":"2-4 句话","suggestions":["最多 3 条给明天的建议"]}。
要求：
- summary 回顾今天做了什么、完成了哪些待办、还有哪些没完成；有记录的话结合记录内容，语气温和、真诚，肯定做得好的地方。
- suggestions 针对明天：没完成的待办怎么安排、明天第一个安排要注意什么。
- 当天一条记录都没有时，在 summary 最后加一句邀请用户说两句今天的事。
- 只根据给出的数据，不要编造；时间用 24 小时制。`,
}

const outputSchema = z.object({
  summary: z.string().trim().min(1).max(600),
  suggestions: z.array(z.string().trim().min(1).max(150)).max(3).default([]),
})

function fmtOcc(o: Occurrence, tz: string) {
  if (o.allDay) return `全天 ${o.title}`
  return `${zonedParts(o.start!, tz).time}–${zonedParts(o.end!, tz).time} ${o.title}${o.location ? `（${o.location}）` : ''}`
}

/** 两个带时间的日程重叠 */
function findConflicts(occ: Occurrence[]) {
  const timed = occ.filter((o) => !o.allDay)
  const out: string[] = []
  for (let i = 0; i < timed.length; i++)
    for (let j = i + 1; j < timed.length; j++)
      if (Date.parse(timed[i]!.start!) < Date.parse(timed[j]!.end!) && Date.parse(timed[j]!.start!) < Date.parse(timed[i]!.end!)) {
        out.push(`「${timed[i]!.title}」和「${timed[j]!.title}」时间重叠`)
      }
  return out
}

interface BriefData {
  date: string
  events: Occurrence[]
  openTasks: Task[]
  doneTasks: Task[]
  entries: { time: string | null; content: string }[]
  tomorrow: Occurrence[]
}

async function collect(db: Db, userId: string, tz: string, date: string): Promise<BriefData> {
  const [events, taskList, entries, tomorrow] = await Promise.all([
    occurrencesInRange(db, userId, date, date, tz),
    tasksForDay(db, userId, date, tz),
    entriesBetween(db, userId, date, date),
    occurrencesInRange(db, userId, addDays(date, 1), addDays(date, 1), tz),
  ])
  return {
    date,
    events,
    openTasks: taskList.filter((t) => !t.done),
    doneTasks: taskList.filter((t) => t.done),
    entries: entries.map((e) => ({ time: e.occurredAt ? zonedParts(e.occurredAt, tz).time : null, content: e.content })),
    tomorrow,
  }
}

function describe(kind: BriefKind, d: BriefData, tz: string, now: Date) {
  const { month, day } = splitKey(d.date)
  const taskLine = (t: Task) => `- ${t.title}${t.dueDate ? (t.dueDate < d.date ? `（逾期，原定 ${t.dueDate}）` : t.dueDate === d.date ? '（今天到期）' : '') : '（没有截止日期）'}${t.priority === 'high' ? '【重要】' : ''}`
  const lines = [
    `【日期】${month}月${day}日 ${weekdayLabel(d.date)}`,
    `【现在】${zonedParts(now, tz).time}`,
    `【今天的日程】\n${d.events.map((o) => `- ${fmtOcc(o, tz)}`).join('\n') || '（没有）'}`,
    `【时间冲突】${findConflicts(d.events).join('；') || '无'}`,
    `【没完成的待办】\n${d.openTasks.map(taskLine).join('\n') || '（没有）'}`,
  ]
  if (kind === 'evening') {
    lines.push(`【今天完成的待办】\n${d.doneTasks.map((t) => `- ${t.title}`).join('\n') || '（没有）'}`)
    lines.push(`【今天的记录】\n${d.entries.map((e) => `- ${e.time ?? ''} ${e.content}`).join('\n') || '（一条都没有）'}`)
    lines.push(`【明天的日程】\n${d.tomorrow.map((o) => `- ${fmtOcc(o, tz)}`).join('\n') || '（没有）'}`)
  }
  return lines.join('\n')
}

/** 模型不可用时的规则版，保证到点也能推送点有用的 */
export function ruleBrief(kind: BriefKind, d: BriefData, tz: string) {
  const late = d.openTasks.filter((t) => t.dueDate && t.dueDate < d.date)
  if (kind === 'morning') {
    const first = d.events.find((o) => !o.allDay)
    const parts = [d.events.length ? `今天有 ${d.events.length} 个安排${first ? `，第一个是 ${zonedParts(first.start!, tz).time} 的「${first.title}」` : ''}` : '今天还没有安排']
    if (d.openTasks.length) parts.push(`还有 ${d.openTasks.length} 件待办${late.length ? `，其中 ${late.length} 件已逾期` : ''}`)
    const conflicts = findConflicts(d.events)
    if (conflicts.length) parts.push(`注意：${conflicts[0]}`)
    return { summary: parts.join('；') + '。', suggestions: [] }
  }
  const parts = [`今天完成了 ${d.doneTasks.length} 件待办${d.openTasks.length ? `，还有 ${d.openTasks.length} 件没完成` : ''}`]
  if (d.tomorrow.length) parts.push(`明天有 ${d.tomorrow.length} 个安排${d.tomorrow[0] && !d.tomorrow[0].allDay ? `，最早 ${zonedParts(d.tomorrow[0].start!, tz).time}` : ''}`)
  if (!d.entries.length) parts.push('今天还没有记录，要不要说两句今天的事？')
  return { summary: parts.join('；') + '。', suggestions: [] }
}

/** 生成并保存（同一天同一种已有就覆盖） */
export async function generateBrief(
  deps: { db: Db; llm: Llm | null | undefined },
  input: { userId: string; tz: string; kind: BriefKind; date: string; now?: Date },
): Promise<DailyBrief> {
  const now = input.now ?? new Date()
  const data = await collect(deps.db, input.userId, input.tz, input.date)
  let out: z.infer<typeof outputSchema> | null = null
  let model = 'rule'
  if (deps.llm?.enabled) {
    try {
      const raw = await deps.llm.chatJson(
        [
          { role: 'system', content: SYSTEM[input.kind] },
          { role: 'user', content: describe(input.kind, data, input.tz, now) },
        ],
        { purpose: `brief-${input.kind}`, userId: input.userId, model: 'summary', maxTokens: 600 },
      )
      const r = outputSchema.safeParse(raw)
      if (r.success) {
        out = r.data
        model = 'ai'
      }
    } catch {
      out = null
    }
  }
  out ??= ruleBrief(input.kind, data, input.tz)

  const [row] = await deps.db
    .insert(dailyBriefs)
    .values({ userId: input.userId, briefDate: input.date, kind: input.kind, summary: out.summary, suggestions: out.suggestions, model })
    .onConflictDoUpdate({
      target: [dailyBriefs.userId, dailyBriefs.briefDate, dailyBriefs.kind],
      set: { summary: out.summary, suggestions: out.suggestions, model, createdAt: new Date() },
    })
    .returning()
  return toBrief(row!)
}

export function toBrief(r: typeof dailyBriefs.$inferSelect): DailyBrief {
  return { id: r.id, date: r.briefDate, kind: r.kind, summary: r.summary, suggestions: r.suggestions, model: r.model, createdAt: r.createdAt.toISOString() }
}

export async function briefsFor(db: Db, userId: string, date: string) {
  const rows = await db.select().from(dailyBriefs).where(and(eq(dailyBriefs.userId, userId), eq(dailyBriefs.briefDate, date)))
  const find = (k: BriefKind) => rows.find((r) => r.kind === k)
  return { morning: find('morning') ? toBrief(find('morning')!) : null, evening: find('evening') ? toBrief(find('evening')!) : null }
}

export const BRIEF_TITLE: Record<BriefKind, string> = { morning: '早报', evening: '今日复盘' }
