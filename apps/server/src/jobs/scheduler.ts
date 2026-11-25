import { and, eq, gte, inArray, lt, max, sql } from 'drizzle-orm'
import { minutesOf, todayKey, zonedParts, type BriefKind } from '@daymate/shared'
import type { Llm } from '../ai/llm.ts'
import type { Db } from '../db/client.ts'
import { dailyBriefs, events, reminders, tasks, userSessions, users } from '../db/schema.ts'
import { BRIEF_TITLE, generateBrief } from '../modules/briefs/generate.ts'
import { notify, type NotifyDeps } from '../modules/notify/notify.ts'
import { syncEventReminders } from '../modules/reminders/schedule.ts'
import { getSettings } from '../modules/settings/repo.ts'

export interface SchedulerDeps extends NotifyDeps {
  llm?: Llm | null
}

/** 提醒时间过了这么久还没发（服务停机），就不再推送，只在站内标"错过的提醒" */
const MISSED_AFTER_MS = 30 * 60_000
const MAX_ATTEMPTS = 3
/** 到了设定时间后这么久之内还没生成就补上；再晚就算了（比如中午才开机，就不补早报） */
const BRIEF_WINDOW_MIN = 180
/** 多久没用过的用户不生成早报复盘（省 AI 费用） */
const INACTIVE_DAYS = 7

function relative(minutes: number) {
  if (minutes <= 0) return '现在开始'
  if (minutes < 60) return `${minutes} 分钟后开始`
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小时后开始`
  return `${Math.round(minutes / 1440)} 天后开始`
}

/**
 * 取出到期的提醒（FOR UPDATE SKIP LOCKED：多个实例同时跑也不会重复发），逐个推送。
 * 重复日程发完后排下一场。返回处理了几条。
 */
export async function runReminderTick(deps: SchedulerDeps, now = new Date()) {
  const { db } = deps
  // 上次发到一半进程挂了的：5 分钟后重新排队
  await db
    .update(reminders)
    .set({ status: 'pending' })
    .where(and(eq(reminders.status, 'sending'), lt(reminders.fireAt, new Date(now.getTime() - 5 * 60_000)), lt(reminders.attempts, MAX_ATTEMPTS)))

  const claimed = (await db.execute(sql`
    update ${reminders} set status = 'sending', attempts = attempts + 1
    where id in (
      select id from ${reminders}
      where status = 'pending' and fire_at <= ${now.toISOString()}::timestamptz
      order by fire_at limit 50
      for update skip locked
    )
    returning id`)) as unknown as { id: string }[]
  if (!claimed.length) return 0
  const rows = await db.select().from(reminders).where(inArray(reminders.id, claimed.map((c) => c.id)))

  for (const r of rows) {
    try {
      const [user] = await db.select({ tz: users.timezone }).from(users).where(eq(users.id, r.userId)).limit(1)
      const tz = user?.tz ?? 'Asia/Shanghai'
      const start = zonedParts(r.occurrenceStart, tz)
      const missed = now.getTime() - r.fireAt.getTime() > MISSED_AFTER_MS
      let title: string
      let body: string
      let link: string

      if (r.eventId) {
        const [ev] = await db.select().from(events).where(eq(events.id, r.eventId)).limit(1)
        if (!ev || ev.deletedAt) {
          await db.delete(reminders).where(eq(reminders.id, r.id))
          continue
        }
        const minutesLeft = Math.round((r.occurrenceStart.getTime() - now.getTime()) / 60_000)
        title = ev.allDay ? `今天：${ev.title}` : `${start.time} ${ev.title}`
        body = [ev.allDay ? '全天' : relative(minutesLeft), ev.location].filter(Boolean).join(' · ')
        link = `/calendar?view=day&date=${start.date}`
      } else {
        const [t] = await db.select().from(tasks).where(eq(tasks.id, r.taskId!)).limit(1)
        if (!t || t.deletedAt || t.doneAt) {
          await db.delete(reminders).where(eq(reminders.id, r.id))
          continue
        }
        title = `待办到期：${t.title}`
        body = `${start.time} 截止`
        link = '/tasks'
      }

      await notify(deps, { userId: r.userId, kind: 'reminder', title: missed ? `错过的提醒：${title}` : title, body, link, deliver: !missed }, now)
      await db.update(reminders).set({ status: missed ? 'missed' : 'sent', sentAt: now }).where(eq(reminders.id, r.id))
      if (r.eventId) await syncEventReminders(db, r.eventId, now)
    } catch (err) {
      deps.log?.warn({ err, reminder: r.id }, '提醒发送失败')
      await db
        .update(reminders)
        .set({ status: r.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending' })
        .where(eq(reminders.id, r.id))
    }
  }
  return rows.length
}

/**
 * 早报 / 复盘：到了用户设定的时间（用户时区）、今天还没生成、最近 7 天用过，就生成并推送。
 * 每次最多处理 limit 个用户，剩下的下一分钟接着来。返回生成了几份。
 */
export async function runBriefTick(deps: SchedulerDeps, now = new Date(), limit = 20) {
  const { db } = deps
  const activeSince = new Date(now.getTime() - INACTIVE_DAYS * 86400_000)
  const active = await db
    .select({ id: users.id, tz: users.timezone, lastUsed: max(userSessions.lastUsedAt), createdAt: users.createdAt })
    .from(users)
    .leftJoin(userSessions, eq(userSessions.userId, users.id))
    .where(eq(users.status, 'active'))
    .groupBy(users.id)
    .having(sql`max(${userSessions.lastUsedAt}) >= ${activeSince.toISOString()}::timestamptz or ${users.createdAt} >= ${activeSince.toISOString()}::timestamptz`)

  let done = 0
  for (const u of active) {
    if (done >= limit) break
    const settings = await getSettings(db, u.id)
    const local = zonedParts(now, u.tz)
    const today = todayKey(u.tz, now)
    const due: BriefKind[] = []
    for (const [kind, cfg] of [['morning', settings.morningBrief], ['evening', settings.eveningReview]] as const) {
      const since = minutesOf(local.time) - minutesOf(cfg.time)
      if (cfg.enabled && since >= 0 && since < BRIEF_WINDOW_MIN) due.push(kind)
    }
    if (!due.length) continue
    const existing = await db
      .select({ kind: dailyBriefs.kind })
      .from(dailyBriefs)
      .where(and(eq(dailyBriefs.userId, u.id), eq(dailyBriefs.briefDate, today), gte(dailyBriefs.createdAt, new Date(now.getTime() - 2 * 86400_000))))
    for (const kind of due.filter((k) => !existing.some((e) => e.kind === k))) {
      const brief = await generateBrief({ db, llm: deps.llm }, { userId: u.id, tz: u.tz, kind, date: today, now })
      const { month, day } = { month: Number(today.slice(5, 7)), day: Number(today.slice(8, 10)) }
      await notify(deps, { userId: u.id, kind: 'brief', title: `${BRIEF_TITLE[kind]} · ${month}月${day}日`, body: brief.summary, link: '/' }, now)
      done++
    }
  }
  return done
}

/** 启动后台任务；返回停止函数。同一个任务上一轮没跑完就跳过这一轮 */
export function startScheduler(deps: SchedulerDeps) {
  const guard = (name: string, fn: () => Promise<unknown>) => {
    let running = false
    return () => {
      if (running) return
      running = true
      fn()
        .catch((err) => deps.log?.warn({ err }, `${name} 失败`))
        .finally(() => (running = false))
    }
  }
  const reminderTick = guard('提醒调度', () => runReminderTick(deps))
  const briefTick = guard('早报复盘', () => runBriefTick(deps))
  const t1 = setInterval(reminderTick, 30_000)
  const t2 = setInterval(briefTick, 60_000)
  t1.unref()
  t2.unref()
  reminderTick()
  return () => {
    clearInterval(t1)
    clearInterval(t2)
  }
}

