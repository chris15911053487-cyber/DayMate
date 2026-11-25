/**
 * 一句话解析评测集（docs/技术方案.md 7.6）：用真实模型跑 cases.json，按字段统计准确率。
 * 改提示词或换模型前后各跑一遍对比。用法（apps/server 目录）：npm run eval [-- 关键词]
 */
import { readFileSync } from 'node:fs'
import { createLlm } from '../src/ai/llm.ts'
import { config } from '../src/config.ts'
import { parseUtterance } from '../src/modules/assistant/parse.ts'

interface Case {
  text: string
  voice?: boolean
  allowExtra?: boolean
  expect: Record<string, unknown>[]
}
const suite = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8')) as { now: string; timezone: string; cases: Case[] }
const filter = process.argv[2]
const cases = suite.cases.filter((c) => !filter || c.text.includes(filter))

const llm = createLlm(config.ai, null)
if (!llm.enabled) {
  console.error('没有配置 AI_API_KEY，无法评测')
  process.exit(1)
}

const get = (o: Record<string, unknown>, path: string): unknown => {
  // "date|dueDate"：取第一个有值的字段
  for (const alt of path.split('|')) {
    const v = alt.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), o)
    if (v !== undefined && v !== null) return v
  }
  return null
}
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
/** 期望值是数组 = 几种都算对（期望值本身是数组时要再包一层） */
function matches(actual: unknown, expected: unknown, field: string) {
  if (field !== 'remindBeforeMin' && field !== 'repeat.byWeekday' && Array.isArray(expected)) return expected.some((e) => same(actual, e))
  if (Array.isArray(expected) && expected.some((e) => Array.isArray(e) || e === null)) return expected.some((e) => same(actual, e))
  return same(actual, expected)
}

const fieldStats: Record<string, { ok: number; total: number }> = {}
let passed = 0
const failures: string[] = []

async function runCase(c: Case) {
  const started = Date.now()
  const r = await parseUtterance(
    { llm, findConflicts: async () => [], describeRange: async () => '（没有安排）' },
    { text: c.text, inputMode: c.voice ? 'voice' : 'text', userId: 'eval', tz: suite.timezone, now: new Date(suite.now) },
  )
  const problems: string[] = []
  if (r.fallback) problems.push('退回成记录（模型没给出可用结果）')
  if (c.allowExtra ? r.items.length < c.expect.length : r.items.length !== c.expect.length) problems.push(`条数 ${r.items.length}，期望 ${c.expect.length}`)
  c.expect.forEach((exp, i) => {
    const got = (r.items[i] ?? {}) as Record<string, unknown>
    for (const [field, want] of Object.entries(exp)) {
      const key = field === 'date|dueDate' ? 'date' : field.split('.')[0]!
      const stat = (fieldStats[key] ??= { ok: 0, total: 0 })
      stat.total++
      const actual = get(got, field)
      if (field === 'type' ? (Array.isArray(want) ? want.includes(actual) : actual === want) : matches(actual, want, field)) stat.ok++
      else problems.push(`[${i}] ${field}: ${JSON.stringify(actual)}，期望 ${JSON.stringify(want)}`)
    }
  })
  if (!problems.length) passed++
  else failures.push(`✗ ${c.text}\n    ${problems.join('\n    ')}\n    输出：${JSON.stringify(r.items)}`)
  process.stdout.write(problems.length ? '✗' : '✓')
  return Date.now() - started
}

// 并发 4 个，别把接口打爆
const latencies: number[] = []
for (let i = 0; i < cases.length; i += 4) latencies.push(...(await Promise.all(cases.slice(i, i + 4).map(runCase))))

console.log(`\n\n模型 ${config.ai.modelParse}｜${cases.length} 条，全对 ${passed} 条（${((passed / cases.length) * 100).toFixed(0)}%）｜平均耗时 ${Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)}ms`)
for (const [k, s] of Object.entries(fieldStats).sort()) console.log(`  ${k.padEnd(16)} ${s.ok}/${s.total}  ${((s.ok / s.total) * 100).toFixed(0)}%`)
if (failures.length) console.log('\n' + failures.join('\n'))
