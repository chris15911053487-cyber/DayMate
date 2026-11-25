import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { SpeechResult } from '@daymate/shared'
import { z } from 'zod'
import type { Db } from '../../db/client.ts'
import { voiceLogs } from '../../db/schema.ts'
import { HttpError } from '../../lib/http-error.ts'
import { consumeQuota } from '../../lib/quota.ts'
import { parse } from '../../lib/validate.ts'
import { userTimezone } from '../auth/users.ts'

/** 60 秒 16k 16bit 单声道 ≈ 1.9MB，base64 后 ≈ 2.6MB */
const MAX_AUDIO_BASE64 = 2_800_000
const bodySchema = z.object({
  audio: z.string().min(100, '没录到声音').max(MAX_AUDIO_BASE64, '一次最长 60 秒'),
  format: z.literal('wav').default('wav'),
  rate: z.literal(16000).default(16000),
  durationMs: z.number().int().min(0).max(70_000).optional(),
})

/** 记下用户最终确认的文字（只改本人、还没记过的那条） */
export async function recordVoiceFinal(db: Db, userId: string, voiceLogId: string | null | undefined, finalText: string | null | undefined) {
  if (!voiceLogId || !finalText) return
  await db
    .update(voiceLogs)
    .set({ finalText: finalText.slice(0, 1000) })
    .where(and(eq(voiceLogs.id, voiceLogId), eq(voiceLogs.userId, userId), isNull(voiceLogs.finalText)))
}

export async function speechRoutes(app: FastifyInstance) {
  const { db, asr, quota } = app.deps

  app.post(
    '/speech/recognize',
    { preHandler: app.authenticate, bodyLimit: 4 * 1024 * 1024, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req): Promise<SpeechResult> => {
      if (!asr) throw new HttpError(503, 'ASR_DISABLED', '语音识别还没配置，先打字吧')
      const body = parse(bodySchema, req.body)
      const userId = req.auth!.userId
      await consumeQuota(db, userId, await userTimezone(db, userId), 'asr', quota.asrPerDay)
      let text: string
      try {
        text = await asr.recognize(body.audio, { userId })
      } catch (err) {
        req.log.error({ err }, '语音识别失败')
        throw new HttpError(502, 'ASR_FAILED', '语音识别失败，请再说一遍或改用打字')
      }
      if (!text) return { text: '', voiceLogId: null }
      const [row] = await db
        .insert(voiceLogs)
        .values({ userId, recognizedText: text.slice(0, 1000), durationMs: body.durationMs ?? null, provider: asr.provider })
        .returning({ id: voiceLogs.id })
      return { text, voiceLogId: row!.id }
    },
  )
}
