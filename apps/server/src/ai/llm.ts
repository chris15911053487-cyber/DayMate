import type { Config } from '../config.ts'
import type { Db } from '../db/client.ts'
import { aiCalls } from '../db/schema.ts'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface Llm {
  readonly enabled: boolean
  /** 让模型输出 JSON 对象并解析；失败抛错。每次调用记一条 ai_calls */
  chatJson(messages: ChatMessage[], opts: { purpose: string; userId: string | null; model?: 'parse' | 'summary'; maxTokens?: number }): Promise<unknown>
}

export class LlmError extends Error {}

/**
 * OpenAI 兼容的 Chat Completions（DeepSeek、通义千问、Kimi 等都支持），只用 fetch，不引 SDK。
 * 强制 response_format = json_object；提示词里必须出现 "json" 字样（DeepSeek 的要求）。
 */
export function createLlm(cfg: Config['ai'], db: Db | null, fetchImpl: typeof fetch = fetch): Llm {
  const url = `${cfg.baseUrl}/chat/completions`
  return {
    enabled: !!cfg.apiKey,
    async chatJson(messages, opts) {
      const model = opts.model === 'summary' ? cfg.modelSummary : cfg.modelParse
      const started = Date.now()
      let usage: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } = {}
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({
            model,
            messages,
            response_format: { type: 'json_object' },
            temperature: 0.2,
            max_tokens: opts.maxTokens ?? 1500,
          }),
          signal: AbortSignal.timeout(cfg.timeoutMs),
        })
        const json = (await res.json().catch(() => null)) as {
          choices?: { message?: { content?: string } }[]
          usage?: typeof usage
          error?: { message?: string }
        } | null
        if (!res.ok || !json) throw new LlmError(`模型接口 ${res.status}：${json?.error?.message ?? '无响应'}`)
        usage = json.usage ?? {}
        const content = json.choices?.[0]?.message?.content ?? ''
        const data = parseJsonLoose(content)
        await log(true)
        return data
      } catch (err) {
        await log(false, err instanceof Error ? err.message : String(err))
        throw err instanceof LlmError ? err : new LlmError((err as Error).message)
      }

      async function log(ok: boolean, error?: string) {
        if (!db) return
        await db
          .insert(aiCalls)
          .values({
            userId: opts.userId,
            purpose: opts.purpose,
            model,
            inputTokens: usage.prompt_tokens ?? null,
            outputTokens: usage.completion_tokens ?? null,
            cachedTokens: usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? null,
            latencyMs: Date.now() - started,
            ok,
            error: error?.slice(0, 500) ?? null,
          })
          .catch(() => {})
      }
    },
  }
}

/** 模型偶尔会包一层 ```json 代码块或在前后加话：取第一个 { 到最后一个 } */
export function parseJsonLoose(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    const s = text.indexOf('{')
    const e = text.lastIndexOf('}')
    if (s >= 0 && e > s) return JSON.parse(text.slice(s, e + 1))
    throw new LlmError('模型没有返回 JSON')
  }
}
