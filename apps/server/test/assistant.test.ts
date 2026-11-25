import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { ChatMessage, Llm } from '../src/ai/llm.ts'
import { parseJsonLoose } from '../src/ai/llm.ts'
import type { Asr } from '../src/asr/index.ts'
import { voiceLogs } from '../src/db/schema.ts'
import { normalizeItem, validateOutput } from '../src/modules/assistant/parse.ts'
import { buildParseUserMessage } from '../src/modules/assistant/prompt.ts'
import { setupTestApp } from './helpers.ts'

/** 假模型：按顺序返回预设的结果（函数可以看到消息内容） */
type Reply = unknown | Error | ((msgs: ChatMessage[]) => unknown)
const llmQueue: Reply[] = []
const llmCalls: { purpose: string; messages: ChatMessage[] }[] = []
const fakeLlm: Llm = {
  enabled: true,
  async chatJson(messages, opts) {
    llmCalls.push({ purpose: opts.purpose, messages })
    const next = llmQueue.shift()
    if (next instanceof Error) throw next
    return typeof next === 'function' ? (next as (m: ChatMessage[]) => unknown)(messages) : next
  },
}
let asrReply: string | Error = '明天下午三点和老王开会'
const fakeAsr: Asr = {
  provider: 'fake',
  async recognize() {
    if (asrReply instanceof Error) throw asrReply
    return asrReply
  },
}

const t = setupTestApp({ asr: fakeAsr, llm: fakeLlm, quota: { asrPerDay: 3, aiPerDay: 100 } })
const { app, db } = t
afterAll(() => t.close())

let token = ''
beforeEach(async () => {
  await t.reset()
  llmQueue.length = 0
  llmCalls.length = 0
  asrReply = '明天下午三点和老王开会'
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'Alice_01', email: 'a@example.com', password: 'daymate-pass-1', agree: true } })
  token = res.json().accessToken
})
const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
  app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${token}` } })
const AUDIO = 'UklGR' + 'A'.repeat(200)

const MEETING = { type: 'event', title: '和老王开会', date: '2026-11-25', startTime: '15:00', endTime: null, allDay: false, location: '国贸', people: ['老王'], remindBeforeMin: [30], repeat: null }

describe('语音识别', () => {
  it('识别成功记一条识别记录（不存录音）', async () => {
    const res = await call('POST', '/speech/recognize', { audio: AUDIO, durationMs: 2300 })
    expect(res.json().text).toBe('明天下午三点和老王开会')
    const [log] = await db.select().from(voiceLogs)
    expect(log).toMatchObject({ recognizedText: '明天下午三点和老王开会', durationMs: 2300, provider: 'fake', finalText: null })
  })

  it('没听清返回空文字、不记录；识别服务出错返回 502', async () => {
    asrReply = ''
    expect((await call('POST', '/speech/recognize', { audio: AUDIO })).json()).toEqual({ text: '', voiceLogId: null })
    asrReply = new Error('boom')
    expect((await call('POST', '/speech/recognize', { audio: AUDIO })).json().code).toBe('ASR_FAILED')
  })

  it('每天额度用完返回 429', async () => {
    for (let i = 0; i < 3; i++) expect((await call('POST', '/speech/recognize', { audio: AUDIO })).statusCode).toBe(200)
    const res = await call('POST', '/speech/recognize', { audio: AUDIO })
    expect(res.statusCode).toBe(429)
    expect(res.json().error).toContain('每天 3 次')
  })
})

describe('一句话解析', () => {
  it('解析出日程和待办；和已有日程冲突的会标出来', async () => {
    await call('POST', '/events', { title: '周会', allDay: false, startDate: '2026-11-25', startTime: '14:30', endTime: '15:30' })
    llmQueue.push({
      items: [MEETING, { type: 'task', title: '交季度报告', dueDate: '2026-11-27', dueTime: null, priority: 'normal' }],
      assumptions: [],
      reply: '好的',
    })
    const res = (await call('POST', '/assistant/parse', { text: '明天下午三点和老王在国贸开会，周五前交报告', inputMode: 'voice' })).json()
    expect(res.fallback).toBe(false)
    expect(res.items).toHaveLength(2)
    expect(res.items[0].conflicts).toEqual([{ title: '周会', time: '14:30–15:30' }])
    // 用户消息带了日期对照和语音提示；系统提示词固定在第一条
    const msgs = llmCalls[0]!.messages
    expect(msgs[0]!.role).toBe('system')
    expect(msgs[1]!.content).toContain('【输入方式】语音')
    expect(msgs[1]!.content).toContain('【用户的话】明天下午三点和老王在国贸开会，周五前交报告')
  })

  it('输出不合格时把问题交回模型重试一次', async () => {
    llmQueue.push({ items: [{ type: 'event', title: '' }] }, { items: [MEETING], reply: 'ok' })
    const res = (await call('POST', '/assistant/parse', { text: '开会' })).json()
    expect(res.items[0].title).toBe('和老王开会')
    expect(llmCalls.map((c) => c.purpose)).toEqual(['parse', 'parse-retry'])
    expect(llmCalls[1]!.messages.at(-1)!.content).toContain('上面的 json 有问题')
  })

  it('模型出错或听不懂：原话存成记录草稿，用户说的话不丢', async () => {
    llmQueue.push(new Error('timeout'))
    const res = (await call('POST', '/assistant/parse', { text: '随便说点什么' })).json()
    expect(res).toMatchObject({ fallback: true, items: [{ type: 'entry', content: '随便说点什么' }] })
    llmQueue.push({ items: [], reply: '没听懂' })
    expect((await call('POST', '/assistant/parse', { text: '嗯嗯' })).json()).toMatchObject({ fallback: true, reply: '没听懂' })
  })

  it('提问：查出范围内的日程交给模型回答', async () => {
    await call('POST', '/events', { title: '牙医', allDay: false, startDate: '2026-11-26', startTime: '10:00', location: '协和' })
    llmQueue.push(
      { items: [{ type: 'query', from: '2026-11-26', to: '2026-11-26', question: '明天有什么安排' }], reply: '' },
      (msgs: ChatMessage[]) => ({ answer: msgs[1]!.content.includes('10:00–11:00：牙医（协和）') ? '明天 10 点看牙医。' : '数据不对' }),
    )
    const res = (await call('POST', '/assistant/parse', { text: '明天有什么安排' })).json()
    expect(res.answer).toBe('明天 10 点看牙医。')
    expect(llmCalls.map((c) => c.purpose)).toEqual(['parse', 'answer'])
  })
})

describe('保存卡片', () => {
  it('一次保存日程、待办、记录；语音来源；没说提醒用默认 15 分钟；记下最终文字', async () => {
    const voice = (await call('POST', '/speech/recognize', { audio: AUDIO })).json()
    const res = await call('POST', '/assistant/commit', {
      inputMode: 'voice',
      voiceLogId: voice.voiceLogId,
      finalText: '明天下午三点和老王开会（改过）',
      items: [
        { ...MEETING, remindBeforeMin: null },
        { type: 'task', title: '买牛奶', dueDate: '2026-11-25' },
        { type: 'entry', content: '想到一个点子 #灵感', date: '2026-11-25', time: '21:00' },
      ],
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().created.map((c: { type: string }) => c.type)).toEqual(['event', 'task', 'entry'])
    const ev = (await call('GET', `/events/${res.json().created[0].id}`)).json()
    expect(ev).toMatchObject({ source: 'voice', remindBeforeMin: [15], start: '2026-11-25T07:00:00.000Z', location: '国贸' })
    const entries = (await call('GET', '/entries?date=2026-11-25')).json()
    expect(entries[0]).toMatchObject({ tags: ['灵感'], source: 'voice' })
    const [log] = await db.select().from(voiceLogs).where(eq(voiceLogs.id, voice.voiceLogId))
    expect(log!.finalText).toBe('明天下午三点和老王开会（改过）')
  })

  it('有一张卡片不合格就全部不保存', async () => {
    const res = await call('POST', '/assistant/commit', {
      items: [{ type: 'task', title: '好的待办' }, { ...MEETING, startTime: '15:00', endTime: '14:00' }],
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('第 2 张卡片')
    expect((await call('GET', '/tasks')).json()).toHaveLength(0)
  })
})

describe('解析的纯函数', () => {
  it('修正模型常见的格式问题', () => {
    expect(normalizeItem({ type: 'event', title: 'a', date: '2026/11/5', startTime: '9:5:00', endTime: 'null' })).toMatchObject({
      date: '2026-11-05', startTime: '09:05', endTime: null, allDay: false,
    })
    expect(normalizeItem({ type: 'event', title: 'a', date: '2026-11-05', startTime: '15:00', endTime: '03:00' })).toMatchObject({ endTime: null })
  })

  it('坏的项丢掉、好的留下', () => {
    const r = validateOutput({ items: [MEETING, { type: 'event' }, { type: 'nope' }], reply: 'x' })
    expect(r.items).toHaveLength(1)
    expect(r.problems).toHaveLength(2)
  })

  it('JSON 外面包了代码块也能解析', () => {
    expect(parseJsonLoose('```json\n{"items":[]}\n```')).toEqual({ items: [] })
  })

  it('日期对照表：本周从周一开始，标出今天明天', () => {
    const msg = buildParseUserMessage('x', { now: new Date('2026-11-24T14:30:00Z'), tz: 'Asia/Shanghai', inputMode: 'text' })
    expect(msg).toContain('【现在】2026-11-24 周二 22:30')
    expect(msg).toContain('2026-11-23 周一 本周（昨天）')
    expect(msg).toContain('2026-11-24 周二 本周（今天）')
    expect(msg).toContain('2026-11-25 周三 本周（明天）')
    expect(msg).toContain('2026-11-29 周日 本周\n2026-11-30 周一 下周')
    expect(msg).toContain('2026-12-02 周三 下周')
    expect(msg).toContain('2026-11-16 周一 上周')
  })
})
