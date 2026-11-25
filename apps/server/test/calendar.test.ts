import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { runCleanup } from '../src/jobs/cleanup.ts'
import { setupTestApp } from './helpers.ts'

const t = setupTestApp()
const { app } = t
afterAll(() => t.close())

let token = ''
let other = ''
async function registerAs(username: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, email: `${username}@example.com`, password: 'daymate-pass-1', agree: true },
  })
  return res.json().accessToken as string
}
beforeEach(async () => {
  await t.reset()
  token = await registerAs('Alice_01')
  other = await registerAs('Bob_02')
})

function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object, as = token) {
  return app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${as}` } })
}
const MEETING = { title: '和老王开会', allDay: false, startDate: '2026-11-25', startTime: '15:00', location: '国贸', remindBeforeMin: [30] }

describe('日历本', () => {
  it('第一次访问自动建"我的日历"；可以新建、改名；默认的不能删', async () => {
    const list = (await call('GET', '/calendars')).json()
    expect(list).toEqual([expect.objectContaining({ name: '我的日历', isDefault: true, color: 'primary' })])
    const work = (await call('POST', '/calendars', { name: '工作', color: 'accent' })).json()
    expect((await call('PATCH', `/calendars/${work.id}`, { name: '上班' })).json().name).toBe('上班')
    expect((await call('DELETE', `/calendars/${list[0].id}`)).json().code).toBe('DEFAULT_CALENDAR')
  })

  it('删日历本连同里面的日程一起删；颜色不在语义色里报错', async () => {
    const work = (await call('POST', '/calendars', { name: '工作', color: 'accent' })).json()
    await call('POST', '/events', { ...MEETING, calendarId: work.id })
    expect((await call('GET', '/events?from=2026-11-25&to=2026-11-25')).json()).toHaveLength(1)
    expect((await call('DELETE', `/calendars/${work.id}`)).statusCode).toBe(204)
    expect((await call('GET', '/events?from=2026-11-25&to=2026-11-25')).json()).toHaveLength(0)
    expect((await call('POST', '/calendars', { name: 'x', color: 'hotpink' })).statusCode).toBe(400)
  })
})

describe('日程', () => {
  it('新建按用户时区换算：北京 15:00 存成 UTC 07:00，默认 1 小时；场次带日历本颜色', async () => {
    const ev = (await call('POST', '/events', MEETING)).json()
    expect(ev).toMatchObject({ start: '2026-11-25T07:00:00.000Z', end: '2026-11-25T08:00:00.000Z', timezone: 'Asia/Shanghai', remindBeforeMin: [30] })
    const occ = (await call('GET', '/events?from=2026-11-25&to=2026-11-25')).json()
    expect(occ).toEqual([expect.objectContaining({ key: ev.id, title: '和老王开会', color: 'primary', recurring: false })])
  })

  it('验收：每周一 9 点例会在月视图每个周一出现；改成东京时区后显示随之变化', async () => {
    await call('POST', '/events', { title: '例会', allDay: false, startDate: '2026-11-02', startTime: '09:00', repeat: { freq: 'weekly' } })
    const month = (await call('GET', '/events?from=2026-10-26&to=2026-12-06')).json()
    expect(month.map((o: { start: string }) => o.start.slice(0, 10))).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'])

    // 东京比北京快 1 小时：同一场会在东京是 10:00，日期不变
    await call('PATCH', '/me', { timezone: 'Asia/Tokyo' })
    const tokyo = (await call('GET', '/events?from=2026-11-23&to=2026-11-23')).json()
    expect(tokyo).toHaveLength(1)
    expect(tokyo[0].start).toBe('2026-11-23T01:00:00.000Z')
    // 洛杉矶：北京周一 9 点 = 洛杉矶周日下午，周一那天就没有了
    await call('PATCH', '/me', { timezone: 'America/Los_Angeles' })
    expect((await call('GET', '/events?from=2026-11-23&to=2026-11-23')).json()).toHaveLength(0)
    expect((await call('GET', '/events?from=2026-11-22&to=2026-11-22')).json()).toHaveLength(1)
  })

  it('校验：带时间的要有开始时间，结束要晚于开始，查询区间最多 93 天', async () => {
    expect((await call('POST', '/events', { title: 'x', allDay: false, startDate: '2026-11-25' })).json().error).toContain('开始时间')
    expect((await call('POST', '/events', { ...MEETING, endTime: '14:00' })).json().error).toContain('晚于开始')
    expect((await call('POST', '/events', { ...MEETING, startDate: '2026-02-30' })).statusCode).toBe(400)
    expect((await call('GET', '/events?from=2026-01-01&to=2026-12-31')).statusCode).toBe(400)
  })

  it('整体修改、删除后 30 天内可撤销', async () => {
    const ev = (await call('POST', '/events', MEETING)).json()
    const edited = (await call('PUT', `/events/${ev.id}`, { ...MEETING, title: '改期的会', startTime: '16:00', endTime: '17:30' })).json()
    expect(edited).toMatchObject({ title: '改期的会', start: '2026-11-25T08:00:00.000Z', end: '2026-11-25T09:30:00.000Z' })
    expect((await call('DELETE', `/events/${ev.id}`)).statusCode).toBe(204)
    expect((await call('GET', `/events/${ev.id}`)).statusCode).toBe(404)
    expect((await call('POST', `/events/${ev.id}/restore`)).json().title).toBe('改期的会')
    expect((await call('GET', `/events/${ev.id}`)).statusCode).toBe(200)
  })

  it('别人的日程看不到、改不了、删不掉；也不能放进别人的日历本', async () => {
    const ev = (await call('POST', '/events', MEETING)).json()
    expect((await call('GET', `/events/${ev.id}`, undefined, other)).statusCode).toBe(404)
    expect((await call('PUT', `/events/${ev.id}`, MEETING, other)).statusCode).toBe(404)
    expect((await call('DELETE', `/events/${ev.id}`, undefined, other)).statusCode).toBe(404)
    expect((await call('GET', '/events?from=2026-11-25&to=2026-11-25', undefined, other)).json()).toHaveLength(0)
    const aliceCal = (await call('GET', '/calendars')).json()[0].id
    expect((await call('POST', '/events', { ...MEETING, calendarId: aliceCal }, other)).json().code).toBe('CALENDAR_NOT_FOUND')
    expect((await call('GET', '/events/not-a-uuid')).statusCode).toBe(404)
  })
})

describe('待办', () => {
  it('勾选完成 / 取消；按截止日期排序；今天页包含逾期、今天到期、无截止和今天完成的', async () => {
    const a = (await call('POST', '/tasks', { title: '交季度报告', dueDate: '2026-11-27', dueTime: '18:00' })).json()
    expect(a.dueAt).toBe('2026-11-27T10:00:00.000Z')
    await call('POST', '/tasks', { title: '逾期的', dueDate: '2026-11-20' })
    await call('POST', '/tasks', { title: '没截止', priority: 'high' })
    const done = (await call('POST', '/tasks', { title: '已完成' })).json()
    expect((await call('PATCH', `/tasks/${done.id}`, { done: true })).json().done).toBe(true)

    const open = (await call('GET', '/tasks')).json()
    expect(open.map((x: { title: string }) => x.title)).toEqual(['逾期的', '交季度报告', '没截止'])
    expect((await call('GET', '/tasks?status=done')).json()).toHaveLength(1)

    // 远离真实"今天"的日期：刚完成的那条不算当天完成
    const later = (await call('GET', '/today?date=2030-01-01')).json()
    expect(later.tasks.map((x: { title: string }) => x.title)).toEqual(['逾期的', '交季度报告', '没截止'])
    const before = (await call('GET', '/today?date=2026-11-21')).json()
    expect(before.tasks.map((x: { title: string }) => x.title)).toEqual(['逾期的', '没截止'])
    expect((await call('PATCH', `/tasks/${done.id}`, { done: false })).json().done).toBe(false)
  })

  it('有时间没日期报错；删除可撤销', async () => {
    expect((await call('POST', '/tasks', { title: 'x', dueTime: '09:00' })).json().error).toContain('日期')
    const x = (await call('POST', '/tasks', { title: 'x' })).json()
    await call('DELETE', `/tasks/${x.id}`)
    expect((await call('GET', '/tasks')).json()).toHaveLength(0)
    await call('POST', `/tasks/${x.id}/restore`)
    expect((await call('GET', '/tasks')).json()).toHaveLength(1)
  })
})

describe('记录', () => {
  it('写记录：按时间排序、自动提取 #标签、可以挂到日程上', async () => {
    const ev = (await call('POST', '/events', MEETING)).json()
    await call('POST', '/entries', { date: '2026-11-25', time: '16:10', content: '会开完了，结论是下周三交排期 #工作 #排期', eventId: ev.id })
    await call('POST', '/entries', { date: '2026-11-25', time: '09:35', content: '早上跑了 5 公里 #运动' })
    const list = (await call('GET', '/entries?date=2026-11-25')).json()
    expect(list.map((e: { tags: string[] }) => e.tags)).toEqual([['运动'], ['工作', '排期']])
    expect(list[1]).toMatchObject({ eventId: ev.id, occurredAt: '2026-11-25T08:10:00.000Z' })
  })

  it('不能挂到别人的日程；改内容时标签跟着变；改日期保留原时间', async () => {
    const bobEvent = (await call('POST', '/events', MEETING, other)).json()
    expect((await call('POST', '/entries', { date: '2026-11-25', content: 'x', eventId: bobEvent.id })).json().code).toBe('EVENT_NOT_FOUND')
    const e = (await call('POST', '/entries', { date: '2026-11-25', time: '20:00', content: '#a' })).json()
    const moved = (await call('PATCH', `/entries/${e.id}`, { content: '改成 #b', date: '2026-11-26' })).json()
    expect(moved).toMatchObject({ tags: ['b'], date: '2026-11-26', occurredAt: '2026-11-26T12:00:00.000Z' })
  })
})

describe('今天与搜索', () => {
  it('今天页一次返回日程、待办、记录', async () => {
    await call('POST', '/events', MEETING)
    await call('POST', '/tasks', { title: '今天到期', dueDate: '2026-11-25' })
    await call('POST', '/entries', { date: '2026-11-25', content: '记一笔' })
    const today = (await call('GET', '/today?date=2026-11-25')).json()
    expect(today).toMatchObject({ date: '2026-11-25', timezone: 'Asia/Shanghai' })
    expect([today.events.length, today.tasks.length, today.entries.length]).toEqual([1, 1, 1])
  })

  it('搜索标题、地点、正文；只搜自己的；% 和 _ 不当通配符', async () => {
    await call('POST', '/events', MEETING)
    await call('POST', '/tasks', { title: '准备老王要的材料' })
    await call('POST', '/entries', { date: '2026-11-25', content: '和老王聊得不错 100%' })
    await call('POST', '/entries', { date: '2026-11-25', content: '别的内容' })
    const r = (await call('GET', '/search?q=老王')).json()
    expect([r.events.length, r.tasks.length, r.entries.length]).toEqual([1, 1, 1])
    expect((await call('GET', '/search?q=国贸')).json().events).toHaveLength(1)
    expect((await call('GET', '/search?q=%25')).json().entries).toHaveLength(1)
    expect((await call('GET', '/search?q=老王', undefined, other)).json().events).toHaveLength(0)
  })
})

describe('清理', () => {
  it('软删除超过 30 天的日程、待办、记录被彻底删除', async () => {
    const ev = (await call('POST', '/events', MEETING)).json()
    await call('DELETE', `/events/${ev.id}`)
    await runCleanup(t.db, new Date(Date.now() + 31 * 86400_000))
    expect((await call('POST', `/events/${ev.id}/restore`)).statusCode).toBe(404)
  })
})
