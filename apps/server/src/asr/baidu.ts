/**
 * 百度短语音识别（移植自 online-report server/src/baidu-asr.js）。
 * 标准版 dev_pid 1537（普通话带标点）；极速版 80001（需单独开通，按次收费）；可带自训练模型 lm_id。
 * 单次最长 60 秒，只认 8k / 16k 采样率。
 */
import type { Config } from '../config.ts'
import type { Asr } from './index.ts'

const TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token'
const STANDARD_URL = 'https://vop.baidu.com/server_api'
const PRO_URL = 'https://vop.baidu.com/pro_api'

export class AsrError extends Error {}

export function createBaiduAsr(cfg: Config['asr'], fetchImpl: typeof fetch = fetch): Asr {
  let cachedToken: string | null = null
  let tokenExpiresAt = 0

  async function token() {
    if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken
    const url = `${TOKEN_URL}?grant_type=client_credentials&client_id=${encodeURIComponent(cfg.apiKey)}&client_secret=${encodeURIComponent(cfg.secretKey)}`
    const json = (await (await fetchImpl(url, { method: 'POST' })).json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string }
    if (!json.access_token) throw new AsrError(`百度 token 获取失败：${json.error_description || json.error || 'unknown'}`)
    cachedToken = json.access_token
    tokenExpiresAt = Date.now() + (json.expires_in ?? 2_592_000) * 1000
    return cachedToken
  }

  return {
    provider: `baidu-${cfg.mode}`,
    async recognize(wavBase64, { userId }) {
      const pro = cfg.mode === 'pro'
      const payload: Record<string, unknown> = {
        format: 'wav',
        rate: 16000,
        channel: 1,
        // cuid 用来在百度控制台按人看调用量
        cuid: `daymate-${userId}`.slice(0, 60),
        token: await token(),
        speech: wavBase64,
        len: Buffer.byteLength(wavBase64, 'base64'),
        dev_pid: cfg.devPid ?? (pro ? 80001 : 1537),
      }
      if (cfg.lmId) payload.lm_id = cfg.lmId
      const res = await fetchImpl(pro ? PRO_URL : STANDARD_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      })
      const json = (await res.json()) as { err_no: number; err_msg?: string; result?: string[] }
      // 3301 = 音频质量差 / 没说话：当成"没听清"，不算错误
      if (json.err_no === 3301) return ''
      if (json.err_no !== 0) throw new AsrError(`百度识别失败 [${json.err_no}] ${json.err_msg ?? ''}`)
      return (json.result ?? []).join('').trim()
    },
  }
}
