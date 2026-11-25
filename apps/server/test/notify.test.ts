import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { todayKey, zonedParts, type PushPayload } from '@daymate/shared'
import type { Llm } from '../src/ai/llm.ts'
import { dailyBriefs, notificationDeliveries, notifications, pushSubscriptions, reminders, users } from '../src/db/schema.ts'
import { runBriefTick, runReminderTick } from '../src/jobs/scheduler.ts'
import type { PushOutcome, PushSender } from '../src/push/index.ts'
import { inQuietHours, mergeSettings } from '../src/modules/settings/repo.ts'
import { setupTestApp } from './helpers.ts'

const pushed: { endpoint: string; payload: PushPayload }[] = []
let pushResult: PushOutcome = { ok: true }
const fakePush: PushSender = {
  publicKey: 'BFakePublicKey',
  async send(target, payload) {
    pushed.push({ endpoint: target.endpoint, payload })
    return pushResult
  },
}
let llmReply: unknown = { summary: '今天 15:00 和老王开会，记得带报告。', suggestions: ['上午先把报告过一遍'] }
const fakeLlm: Llm = {
  enabled: true,
  async chatJson() {
    if (llmReply instanceof Error) throw llmReply
    return llmReply
  },
}

const t = setupTestApp({ push: fakePush, llm: fakeLlm })
const { app, db, mails } = t
const deps = { db, mailer: t.mailer, push: fakePush, llm: fakeLlm, publicBaseUrl: 'https://daymate.test' }
afterAll(() => t.close())

let token = ''
let userId = ''
const TZ = 'Asia/Shanghai'
beforeEach(async () => {
  await t.reset()
  pushed.length = 0
  pushResult = { ok: true }
  llmReply = { summary: '今天 15:00 和老王开会，记得带报告。', suggestions: ['上午先把报告过一遍'] }
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'Alice_01', email: 'a@example.com', password: 'daymate-pass-1', agree: true } })
  token = res.json().accessToken
  userId = res.json().user.id
})
const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${token}` } })
const subscribe = (endpoint = 'https://push.example.com/abc') =>
  call('POST', '/push/subscriptions', { endpoint, keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(16) } })

/** 北京时间的"现在 + n 分钟"拆成日期和时间（建日程用） */
function at(minutesFromNow: number) {
  const p = zonedParts(Date.now() + minutesFromNow * 60_000, TZ)
  return { startDate: p.date, startTime: p.time }
}
const pendingFor = (eventId: string) => db.select().from(reminders).where(and(eq(reminders.eventId, eventId), eq(reminders.status, 'pending')))

describe('设置', () => {
  it('默认值；部分修改会合并；时间格式不对报错', async () => {
    expect((await call('GET', '/me/settings')).json()).toMatchObject({ morningBrief: { enabled: true, time: '07:30' }, defaultRemindMin: 15 })
    const r = (await call('PUT', '/me/settings', { channels: { reminder: { webpush: true, email: true } } })).json()
    expect(r.channels).toEqual({ reminder: { webpush: true, email: true }, brief: { webpush: true, email: false } })
    expect((await call('PUT', '/me/settings', { morningBrief: { enabled: true, time: '25:00' } })).statusCode).toBe(400)
  })

  it('免打扰时段可以跨午夜', () => {
    const s = mergeSettings(null)
    expect([inQuietHours(s, '23:30'), inQuietHours(s, '06:59'), inQuietHours(s, '07:00'), inQuietHours(s, '12:00')]).toEqual([true, true, false, false])
  })
})

describe('提醒排期', () => {
  it('新建、改提醒、删除、撤销都会重排', async () => {
    const ev = (await call('POST', '/events', { title: '开会', allDay: false, ...at(120), remindBeforeMin: [15] })).json()
    let [r] = await pendingFor(ev.id)
    expect(r!.fireAt.getTime()).toBe(Date.parse(ev.start) - 15 * 60_000)

    await call('PUT', `/events/${ev.id}`, { title: '开会', allDay: false, ...at(120), remindBeforeMin: [30, 0] })
    const both = await pendingFor(ev.id)
    expect(both.map((x) => x.remindMin).sort((a, b) => a - b)).toEqual([0, 30])

    await call('DELETE', `/events/${ev.id}`)
    expect(await pendingFor(ev.id)).toHaveLength(0)
    await call('POST', `/events/${ev.id}/restore`)
    expect(await pendingFor(ev.id)).toHaveLength(2)
  })

  it('离开始不到 15 分钟才建的日程：立即提醒', async () => {
    const ev = (await call('POST', '/events', { title: '马上开始', allDay: false, ...at(5), remindBeforeMin: [15] })).json()
    const [r] = await pendingFor(ev.id)
    expect(r!.fireAt.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('有截止时间的待办到点提醒，勾选完成后撤掉', async () => {
    const p = at(60)
    const task = (await call('POST', '/tasks', { title: '交报告', dueDate: p.startDate, dueTime: p.startTime })).json()
    const rows = () => db.select().from(reminders).where(and(eq(reminders.taskId, task.id), eq(reminders.status, 'pending')))
    expect(await rows()).toHaveLength(1)
    await app.inject({ method: 'PATCH', headers: { authorization: `Bearer ${token}` }, url: '/api' + `/tasks/${task.id}`, payload: { done: true } })
    expect(await rows()).toHaveLength(0)
  })
})

describe('发送提醒', () => {
  it('到点：写站内消息 + 推送；重复日程接着排下一场；不会重复发', async () => {
    await subscribe()
    const ev = (await call('POST', '/events', { title: '例会', allDay: false, ...at(60), location: '3 楼', remindBeforeMin: [15], repeat: { freq: 'weekly' } })).json()
    const [r] = await pendingFor(ev.id)

    expect(await runReminderTick(deps, new Date(r!.fireAt.getTime() + 1000))).toBe(1)
    const [n] = await db.select().from(notifications)
    expect(n).toMatchObject({ kind: 'reminder', body: '15 分钟后开始 · 3 楼' })
    expect(n!.title).toContain('例会')
    expect(pushed).toHaveLength(1)
    expect(pushed[0]!.payload).toMatchObject({ title: n!.title, url: expect.stringContaining('/calendar?view=day&date=') })

    // 下一场：一周后
    const [next] = await pendingFor(ev.id)
    expect(next!.occurrenceStart.getTime() - r!.occurrenceStart.getTime()).toBe(7 * 86400_000)
    // 再跑一次不会重复发
    expect(await runReminderTick(deps, new Date(r!.fireAt.getTime() + 2000))).toBe(0)
  })

  it('服务停机错过 30 分钟以上：只写站内"错过的提醒"，不推送', async () => {
    await subscribe()
    const ev = (await call('POST', '/events', { title: '晨会', allDay: false, ...at(60), remindBeforeMin: [15] })).json()
    const [r] = await pendingFor(ev.id)
    await runReminderTick(deps, new Date(r!.fireAt.getTime() + 2 * 3600_000))
    const [n] = await db.select().from(notifications)
    expect(n!.title).toMatch(/^错过的提醒：/)
    expect(pushed).toHaveLength(0)
    const [row] = await db.select().from(reminders).where(eq(reminders.id, r!.id))
    expect(row!.status).toBe('missed')
  })

  it('推送服务说订阅失效（410）就删掉订阅；记下每个渠道的结果', async () => {
    await subscribe()
    pushResult = { ok: false, gone: true, error: '410 Gone' }
    const ev = (await call('POST', '/events', { title: 'x', allDay: false, ...at(60), remindBeforeMin: [15] })).json()
    const [r] = await pendingFor(ev.id)
    await runReminderTick(deps, new Date(r!.fireAt.getTime() + 1000))
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0)
    const [d] = await db.select().from(notificationDeliveries)
    expect(d).toMatchObject({ channel: 'webpush', status: 'failed' })
  })

  it('邮件渠道：邮箱验证过才发；免打扰不拦日程提醒', async () => {
    await call('PUT', '/me/settings', { channels: { reminder: { webpush: false, email: true } }, quietHours: { enabled: true, start: '00:00', end: '23:59' } })
    const ev = (await call('POST', '/events', { title: '看牙', allDay: false, ...at(60), remindBeforeMin: [15] })).json()
    const [r] = await pendingFor(ev.id)
    mails.length = 0
    await runReminderTick(deps, new Date(r!.fireAt.getTime() + 1000))
    expect(mails).toHaveLength(0)
    expect((await db.select().from(notificationDeliveries))[0]).toMatchObject({ channel: 'email', status: 'skipped', detail: '邮箱未验证' })

    await db.update(users).set({ emailVerifiedAt: new Date() })
    await call('PUT', `/events/${ev.id}`, { title: '看牙', allDay: false, ...at(90), remindBeforeMin: [15] })
    const [r2] = await pendingFor(ev.id)
    await runReminderTick(deps, new Date(r2!.fireAt.getTime() + 1000))
    expect(mails.at(-1)).toMatchObject({ to: 'a@example.com' })
    expect(mails.at(-1)!.subject).toContain('看牙')
  })
})

describe('早报与复盘', () => {
  async function setMorningTo(now: Date) {
    await call('PUT', '/me/settings', { morningBrief: { enabled: true, time: zonedParts(now, TZ).time }, eveningReview: { enabled: false, time: '21:30' }, quietHours: { enabled: false, start: '23:00', end: '07:00' } })
  }

  it('到了设定时间生成 AI 早报并推送；同一天不重复；今天页能看到', async () => {
    await subscribe()
    const now = new Date()
    await setMorningTo(now)
    expect(await runBriefTick(deps, new Date(now.getTime() + 60_000))).toBe(1)
    expect(await runBriefTick(deps, new Date(now.getTime() + 120_000))).toBe(0)
    const [b] = await db.select().from(dailyBriefs)
    expect(b).toMatchObject({ kind: 'morning', model: 'ai', summary: '今天 15:00 和老王开会，记得带报告。' })
    expect(pushed[0]!.payload.title).toMatch(/^早报 · /)
    const today = (await call('GET', '/today')).json()
    expect(today.briefs.morning.suggestions).toEqual(['上午先把报告过一遍'])
  })

  it('模型出错时用规则生成，照样推送', async () => {
    llmReply = new Error('down')
    await call('POST', '/tasks', { title: '逾期的', dueDate: '2020-01-01' })
    const now = new Date()
    await setMorningTo(now)
    await runBriefTick(deps, now)
    const [b] = await db.select().from(dailyBriefs)
    expect(b!.model).toBe('rule')
    expect(b!.summary).toContain('1 件已逾期')
  })

  it('还没到时间、超过 3 小时窗口、关掉了、7 天没用过：都不生成', async () => {
    const now = new Date()
    await setMorningTo(now)
    expect(await runBriefTick(deps, new Date(now.getTime() - 60_000))).toBe(0)
    expect(await runBriefTick(deps, new Date(now.getTime() + 181 * 60_000))).toBe(0)
    await db.update(users).set({ createdAt: new Date(Date.now() - 30 * 86400_000) })
    await db.execute(sql`update user_sessions set last_used_at = now() - interval '8 days'`)
    expect(await runBriefTick(deps, new Date(now.getTime() + 60_000))).toBe(0)
  })

  it('免打扰时段：早报只写站内，不推送', async () => {
    await subscribe()
    const now = new Date()
    const local = zonedParts(now, TZ).time
    await call('PUT', '/me/settings', { morningBrief: { enabled: true, time: local }, eveningReview: { enabled: false, time: '21:30' }, quietHours: { enabled: true, start: '00:00', end: '23:59' } })
    await runBriefTick(deps, new Date(now.getTime() + 60_000))
    expect(await db.select().from(notifications)).toHaveLength(1)
    expect(pushed).toHaveLength(0)
  })

  it('手动生成复盘', async () => {
    const r = (await call('POST', '/briefs/generate', { kind: 'evening' })).json()
    expect(r).toMatchObject({ kind: 'evening', date: todayKey(TZ), model: 'ai' })
  })
})

describe('站内消息与推送订阅', () => {
  it('列表、未读数、标记已读、全部已读；看不到别人的', async () => {
    await call('POST', '/push/test')
    await call('POST', '/push/test')
    const page = (await call('GET', '/notifications')).json()
    expect(page.items).toHaveLength(2)
    expect(page.unread).toBe(2)
    expect((await call('POST', `/notifications/${page.items[0].id}/read`)).json().unread).toBe(1)
    expect((await call('POST', '/notifications/read-all')).json().unread).toBe(0)

    const bob = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'Bob_02', email: 'b@example.com', password: 'daymate-pass-1', agree: true } })).json().accessToken
    const bobPage = (await app.inject({ url: '/api/notifications', headers: { authorization: `Bearer ${bob}` } })).json()
    expect(bobPage.items).toHaveLength(0)
  })

  it('同一个浏览器重复订阅只保留一条；可以取消', async () => {
    expect((await call('GET', '/push/config')).json()).toEqual({ enabled: true, publicKey: 'BFakePublicKey' })
    await subscribe()
    await subscribe()
    expect(await db.select().from(pushSubscriptions)).toHaveLength(1)
    await call('DELETE', '/push/subscriptions', { endpoint: 'https://push.example.com/abc' })
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0)
  })
})
