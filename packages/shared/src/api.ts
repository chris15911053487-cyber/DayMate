import { z } from 'zod'

/** 统一错误响应：{ error, code, detail? }（沿用 online-report 约定） */
export const apiErrorSchema = z.object({
  error: z.string(),
  code: z.string(),
  detail: z.string().optional(),
})
export type ApiError = z.infer<typeof apiErrorSchema>

export const healthSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  db: z.enum(['up', 'down']),
  time: z.string(),
})
export type Health = z.infer<typeof healthSchema>
