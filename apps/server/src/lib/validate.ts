import type { z } from 'zod'
import { HttpError } from './http-error.ts'

/** 校验请求体；不通过时把第一条中文提示返回给前端 */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data ?? {})
  if (!r.success) {
    const issue = r.error.issues[0]
    throw new HttpError(400, 'VALIDATION', issue?.message ?? '参数不对')
  }
  return r.data
}
