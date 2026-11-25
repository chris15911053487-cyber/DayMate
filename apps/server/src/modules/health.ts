import type { FastifyInstance } from 'fastify'
import type { Health } from '@daymate/shared'

export function healthRoutes(app: FastifyInstance, opts: { version: string; pingDb: () => Promise<boolean> }) {
  // 容器健康检查每 30 秒一次（/api/health），不记访问日志
  app.get('/health', { logLevel: 'warn' }, async (_req, reply): Promise<Health> => {
    const up = await opts.pingDb()
    if (!up) reply.code(503)
    return { ok: up, version: opts.version, db: up ? 'up' : 'down', time: new Date().toISOString() }
  })
}
