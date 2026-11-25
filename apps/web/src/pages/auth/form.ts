import { useState } from 'react'
import type { z } from 'zod'
import { ApiError } from '../../api/client'

/** 用共享的 zod 规则做前端校验：返回每个字段的第一条提示 */
export function fieldErrors(schema: z.ZodType, data: unknown): Record<string, string> {
  const r = schema.safeParse(data)
  if (r.success) return {}
  const out: Record<string, string> = {}
  for (const issue of r.error.issues) {
    const key = String(issue.path[0] ?? '_')
    out[key] ??= issue.message
  }
  return out
}

/** 表单提交状态：字段错误、整体错误、提交中 */
export function useFormState<F extends string>() {
  const [errors, setErrors] = useState<Partial<Record<F | '_', string>>>({})
  const [busy, setBusy] = useState(false)

  async function submit(run: () => Promise<void>, fieldForCode: Partial<Record<string, F>> = {}) {
    setBusy(true)
    try {
      await run()
    } catch (err) {
      if (err instanceof ApiError) {
        const field = fieldForCode[err.code]
        setErrors(field ? { [field]: err.message } as Partial<Record<F | '_', string>> : { _: err.message } as Partial<Record<F | '_', string>>)
      } else {
        setErrors({ _: '出错了，请稍后再试' } as Partial<Record<F | '_', string>>)
      }
    } finally {
      setBusy(false)
    }
  }
  /** 用户改了某个字段，就收起这个字段的错误（和整体错误），让实时提示重新显示 */
  function clearError(field: F) {
    setErrors((e) => (e[field] || e._ ? { ...e, [field]: undefined, _: undefined } : e))
  }
  return { errors, setErrors, clearError, busy, submit }
}
