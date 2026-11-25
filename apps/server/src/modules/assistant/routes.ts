import type { FastifyInstance } from 'fastify'
import {
  commitRequestSchema,
  extractTags,
  eventInputSchema,
  parseRequestSchema,
  zonedParts,
  zonedToUtc,
  type CommitResult,
  type ConflictInfo,
  type EventDraft,
  type ParseResult,
} from '@daymate/shared'
import { entries, events, tasks } from '../../db/schema.ts'
import { HttpError } from '../../lib/http-error.ts'
import { consumeQuota } from '../../lib/quota.ts'
import { parse } from '../../lib/validate.ts'
import { userTimezone } from '../auth/users.ts'
import { inputToColumns } from '../calendar/occurrences.ts'
import { listCalendars, occurrencesInRange, resolveCalendar } from '../calendar/repo.ts'
import { tasksForDay } from '../tasks/routes.ts'
import { recordVoiceFinal } from '../speech/routes.ts'
import { eventDraftToInput, parseUtterance } from './parse.ts'
import { syncEventReminders, syncTaskReminders } from '../reminders/schedule.ts'
import { getSettings } from '../settings/repo.ts'

export async function assistantRoutes(app: FastifyInstance) {
  const { db, llm, quota } = app.deps
  app.addHook('preHandler', app.authenticate)

  app.post('/assistant/parse', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req): Promise<ParseResult> => {
    const input = parse(parseRequestSchema, req.body)
    const userId = req.auth!.userId
    const tz = await userTimezone(db, userId)
    if (llm?.enabled) await consumeQuota(db, userId, tz, 'ai', quota.aiPerDay)
    const calendars = await listCalendars(db, userId)

    const fmt = (iso: string) => zonedParts(iso, tz).time
    return parseUtterance(
      {
        llm: llm ?? { enabled: false, chatJson: async () => ({}) },
        async findConflicts(draft: EventDraft): Promise<ConflictInfo[]> {
          const ev = eventInputSchema.safeParse(eventDraftToInput(draft))
          if (!ev.success) return []
          const cols = inputToColumns(ev.data, tz)
          if (!cols.startAt || !cols.endAt) return []
          const occ = await occurrencesInRange(db, userId, draft.date, draft.endDate ?? draft.date, tz)
          return occ
            .filter((o) => !o.allDay && Date.parse(o.start!) < cols.endAt!.getTime() && Date.parse(o.end!) > cols.startAt!.getTime())
            .map((o) => ({ title: o.title, time: `${fmt(o.start!)}–${fmt(o.end!)}` }))
        },
        async describeRange(from, to) {
          const occ = await occurrencesInRange(db, userId, from, to, tz)
          const open = (await tasksForDay(db, userId, to, tz)).filter((t) => !t.done && t.dueDate && t.dueDate >= from)
          const lines = occ.map((o) => {
            if (o.allDay) return `- ${o.startDate} 全天：${o.title}`
            const s = zonedParts(o.start!, tz)
            return `- ${s.date} ${s.time}–${fmt(o.end!)}：${o.title}${o.location ? `（${o.location}）` : ''}`
          })
          const taskLines = open.map((t) => `- 待办「${t.title}」截止 ${t.dueDate}`)
          return [...lines, ...taskLines].join('\n') || '（没有安排）'
        },
      },
      { text: input.text, inputMode: input.inputMode, userId, tz, calendars: calendars.map((c) => c.name) },
    )
  })

  /** 保存确认后的卡片：一次提交多张，要么全成功要么全不保存 */
  app.post('/assistant/commit', async (req, reply): Promise<CommitResult> => {
    const input = parse(commitRequestSchema, req.body)
    const userId = req.auth!.userId
    const tz = await userTimezone(db, userId)
    const source = input.inputMode === 'voice' ? ('voice' as const) : ('text' as const)
    const { defaultRemindMin } = await getSettings(db, userId)

    // 先全部校验、换算，再在一个事务里写入
    const prepared = await Promise.all(
      input.items.map(async (it, i) => {
        if (it.type === 'event') {
          const ev = eventInputSchema.safeParse(eventDraftToInput(it, defaultRemindMin))
          if (!ev.success) throw new HttpError(400, 'VALIDATION', `第 ${i + 1} 张卡片：${ev.error.issues[0]!.message}`)
          const cal = await resolveCalendar(db, userId, ev.data.calendarId)
          return { type: 'event' as const, values: { userId, calendarId: cal.id, source, ...inputToColumns(ev.data, tz) } }
        }
        if (it.type === 'task') {
          if (it.dueTime && !it.dueDate) throw new HttpError(400, 'VALIDATION', `第 ${i + 1} 张卡片：设了时间就要设日期`)
          return {
            type: 'task' as const,
            values: {
              userId,
              title: it.title,
              priority: it.priority ?? 'normal',
              dueDate: it.dueDate ?? null,
              dueAt: it.dueDate && it.dueTime ? zonedToUtc(it.dueDate, it.dueTime, tz) : null,
              source,
            },
          }
        }
        return {
          type: 'entry' as const,
          values: {
            userId,
            entryDate: it.date,
            occurredAt: it.time ? zonedToUtc(it.date, it.time, tz) : null,
            content: it.content,
            tags: extractTags(it.content),
            source,
          },
        }
      }),
    )

    const created = await db.transaction(async (tx) => {
      const out: CommitResult['created'] = []
      for (const p of prepared) {
        if (p.type === 'event') {
          const [r] = await tx.insert(events).values(p.values).returning({ id: events.id, title: events.title })
          out.push({ type: 'event', ...r! })
        } else if (p.type === 'task') {
          const [r] = await tx.insert(tasks).values(p.values).returning({ id: tasks.id, title: tasks.title })
          out.push({ type: 'task', ...r! })
        } else {
          const [r] = await tx.insert(entries).values(p.values).returning({ id: entries.id, title: entries.content })
          out.push({ type: 'entry', id: r!.id, title: r!.title.slice(0, 30) })
        }
      }
      return out
    })
    for (const c of created) {
      if (c.type === 'event') await syncEventReminders(db, c.id)
      if (c.type === 'task') await syncTaskReminders(db, c.id)
    }
    await recordVoiceFinal(db, userId, input.voiceLogId, input.finalText)
    reply.code(201)
    return { created }
  })
}
