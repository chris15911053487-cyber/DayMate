import fs from 'node:fs'
import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import type { ApiError } from '@daymate/shared'
import { authPlugin, type AppDeps } from './modules/auth/plugin.ts'
import { authRoutes } from './modules/auth/routes.ts'
import { healthRoutes } from './modules/health.ts'
import { meRoutes } from './modules/me/routes.ts'
import { calendarRoutes } from './modules/calendar/routes.ts'
import { entryRoutes } from './modules/entries/routes.ts'
import { taskRoutes } from './modules/tasks/routes.ts'
import { todayRoutes } from './modules/today/routes.ts'
import { assistantRoutes } from './modules/assistant/routes.ts'
import { speechRoutes } from './modules/speech/routes.ts'
import { notifyRoutes } from './modules/notify/routes.ts'

export interface AppOptions {
  version: string
  pingDb: () => Promise<boolean>
  /** 账号相关依赖；不传则只有健康检查（单测外壳用） */
  auth?: AppDeps
  /** 前端构建产物目录；不存在则不托管页面 */
  webDist?: string
  logger?: boolean
}

/** 页面和静态文件的内部前缀：非 /api 的地址都改写到这里，永远碰不到接口路由 */
const WEB_PREFIX = '/__web'

/**
 * 前端一律请求 /api/...；rewriteUrl 去掉前缀再匹配，路由本身不写 /api（同 online-report）。
 * 其余地址加上 /__web 前缀：静态文件按文件名命中，页面地址（如 /me，和接口 GET /me 同名）回退到 index.html。
 */
export function buildApp(opts: AppOptions) {
  const app = Fastify({
    logger: opts.logger ?? false,
    // 只经 Caddy 访问，取 X-Forwarded-For 里的真实 IP（限流、登录设备列表用）
    trustProxy: true,
    rewriteUrl: (req) => {
      const url = req.url ?? '/'
      if (url === '/api' || url.startsWith('/api/') || url.startsWith('/api?')) return url.slice(4) || '/'
      return WEB_PREFIX + url
    },
  })

  // CSP 先关：index.html 里有启动前套主题的内联脚本，M6 上线前改成按 hash 放行
  app.register(helmet, { contentSecurityPolicy: false })

  app.register(async (api) => {
    healthRoutes(api, opts)
    if (opts.auth) {
      const deps = opts.auth
      if (deps.rateLimit !== false) {
        await api.register(rateLimit, {
          global: false,
          errorResponseBuilder: (_req, ctx) => ({
            statusCode: 429,
            code: 'RATE_LIMITED',
            error: `操作太频繁了，请 ${Math.ceil(ctx.ttl / 1000 / 60) || 1} 分钟后再试`,
          }),
        })
      }
      await api.register(authPlugin, deps)
      await api.register(authRoutes)
      await api.register(meRoutes)
      await api.register(calendarRoutes)
      await api.register(taskRoutes)
      await api.register(entryRoutes)
      await api.register(todayRoutes)
      await api.register(speechRoutes)
      await api.register(assistantRoutes)
      await api.register(notifyRoutes)
    }
  })

  const hasWeb = !!opts.webDist && fs.existsSync(opts.webDist)
  if (hasWeb) {
    app.register(fastifyStatic, { root: opts.webDist!, prefix: `${WEB_PREFIX}/`, wildcard: false, index: false })
  }

  app.setNotFoundHandler((req, reply) => {
    const isPage = req.url.startsWith(WEB_PREFIX)
    const wantsHtml = req.method === 'GET' && (req.headers.accept ?? '').includes('text/html')
    if (hasWeb && isPage && wantsHtml) return reply.sendFile('index.html')
    const body: ApiError = { error: '接口不存在', code: 'NOT_FOUND' }
    return reply.code(404).send(body)
  })

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string; error?: string }, _req, reply) => {
    const status = err.statusCode ?? 500
    if (status >= 500) app.log.error(err)
    const body: ApiError = {
      error: status >= 500 ? '服务器出错了，请稍后再试' : err.error ?? err.message,
      code: err.code && !err.code.startsWith('FST_') ? err.code : status >= 500 ? 'INTERNAL' : 'BAD_REQUEST',
    }
    return reply.code(status).send(body)
  })

  return app
}
