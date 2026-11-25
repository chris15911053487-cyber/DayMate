import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import cookie from '@fastify/cookie'
import jwt from '@fastify/jwt'
import type { Db } from '../../db/client.ts'
import { HttpError } from '../../lib/http-error.ts'
import type { Llm } from '../../ai/llm.ts'
import type { Asr } from '../../asr/index.ts'
import type { Mailer } from '../../lib/mailer.ts'
import type { PushSender } from '../../push/index.ts'
import { ACCESS_TTL_SEC, activeSession } from './sessions.ts'

export interface AppDeps {
  db: Db
  mailer: Mailer
  jwtSecret: string
  publicBaseUrl: string
  cookieSecure: boolean
  /** 测试时关掉限流；单独有一条用例验证限流 */
  rateLimit?: boolean
  /** 语音识别；没配置时 /speech/recognize 返回 503 */
  asr?: Asr | null
  /** 大模型；没配置时一句话解析直接退回"存成记录" */
  llm?: Llm | null
  quota: { asrPerDay: number; aiPerDay: number }
  /** 浏览器推送；没配 VAPID 密钥时为 null */
  push?: PushSender | null
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
  interface FastifyRequest {
    auth?: { userId: string; sessionId: string }
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; sid: string }
    user: { sub: string; sid: string }
  }
}

/** 刷新令牌 Cookie：只发给 /api/auth 下的接口，前端脚本读不到 */
export const REFRESH_COOKIE = 'dm_rt'
export const REFRESH_COOKIE_PATH = '/api/auth'

/**
 * 访问令牌（JWT，30 分钟）只证明"是谁、哪个会话"；每次请求再查一下会话是否还有效，
 * 这样"踢掉设备""改密码""注销"立刻生效，不用等令牌过期。
 */
export const authPlugin = fp(async (app: FastifyInstance, deps: AppDeps) => {
  app.decorate('deps', deps)
  await app.register(cookie)
  await app.register(jwt, { secret: deps.jwtSecret, sign: { expiresIn: ACCESS_TTL_SEC } })

  app.decorate('authenticate', async (req: FastifyRequest) => {
    let payload: { sub: string; sid: string }
    try {
      payload = await req.jwtVerify()
    } catch {
      throw new HttpError(401, 'UNAUTHORIZED', '请先登录')
    }
    const s = await activeSession(deps.db, payload.sid)
    if (!s || s.userId !== payload.sub) throw new HttpError(401, 'SESSION_INVALID', '登录已失效，请重新登录')
    req.auth = { userId: payload.sub, sessionId: payload.sid }
  })
})

export function signAccessToken(app: FastifyInstance, userId: string, sessionId: string) {
  return app.jwt.sign({ sub: userId, sid: sessionId })
}
