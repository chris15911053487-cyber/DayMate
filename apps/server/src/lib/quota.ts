import { sql } from 'drizzle-orm'
import { todayKey } from '@daymate/shared'
import type { Db } from '../db/client.ts'
import { usageDaily } from '../db/schema.ts'
import { HttpError } from './http-error.ts'

const LABEL = { asr: '语音识别', ai: 'AI' } as const

/** 用掉一次额度（按用户时区的今天计）；超过上限抛 429 */
export async function consumeQuota(db: Db, userId: string, tz: string, kind: 'asr' | 'ai', limit: number) {
  const day = todayKey(tz)
  const col = kind === 'asr' ? usageDaily.asrCount : usageDaily.aiCount
  const [row] = await db
    .insert(usageDaily)
    .values({ userId, day, asrCount: kind === 'asr' ? 1 : 0, aiCount: kind === 'ai' ? 1 : 0 })
    .onConflictDoUpdate({ target: [usageDaily.userId, usageDaily.day], set: { [kind === 'asr' ? 'asrCount' : 'aiCount']: sql`${col} + 1` } })
    .returning({ asr: usageDaily.asrCount, ai: usageDaily.aiCount })
  const used = kind === 'asr' ? row!.asr : row!.ai
  if (used > limit) throw new HttpError(429, 'QUOTA_EXCEEDED', `今天的${LABEL[kind]}次数用完了（每天 ${limit} 次），明天再来，或者先手动添加`)
}
