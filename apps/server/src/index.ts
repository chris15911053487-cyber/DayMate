import { config } from './config.ts'
import { buildApp } from './app.ts'
import { createDb } from './db/client.ts'
import { startCleanupJob } from './jobs/cleanup.ts'
import { startScheduler } from './jobs/scheduler.ts'
import { createWebPush } from './push/index.ts'
import { createLlm } from './ai/llm.ts'
import { createBaiduAsr } from './asr/baidu.ts'
import { createMailer } from './lib/mailer.ts'

async function main() {
  const { db, pg, migrate, ping } = createDb(config.databaseUrl)
  await migrate(config.migrationsDir)

  const mailer = createMailer(config.smtp, (msg) => console.log(msg))
  const llm = createLlm(config.ai, db)
  const push = createWebPush(config.vapid)
  const app = buildApp({
    version: config.version,
    pingDb: ping,
    webDist: config.webDist,
    logger: true,
    auth: {
      db,
      mailer,
      jwtSecret: config.jwtSecret,
      publicBaseUrl: config.publicBaseUrl,
      cookieSecure: config.cookieSecure,
      rateLimit: config.rateLimit,
      asr: config.asr.apiKey && config.asr.secretKey ? createBaiduAsr(config.asr) : null,
      llm,
      push,
      quota: config.quota,
    },
  })
  await app.listen({ port: config.port, host: config.host })
  const stopCleanup = startCleanupJob(db, app.log)
  const stopScheduler = startScheduler({ db, mailer, push, llm, publicBaseUrl: config.publicBaseUrl, log: app.log })

  const shutdown = async () => {
    stopCleanup()
    stopScheduler()
    await app.close()
    await pg.end({ timeout: 5 })
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((err) => {
  console.error('启动失败', err)
  process.exit(1)
})
