import { sql } from 'drizzle-orm'
import type { LightMyRequestResponse } from 'fastify'
import { buildApp } from '../src/app.ts'
import { createDb } from '../src/db/client.ts'
import type { Mail, Mailer } from '../src/lib/mailer.ts'
import type { AppDeps } from '../src/modules/auth/plugin.ts'

const url = process.env.TEST_DATABASE_URL || 'postgres://daymate:daymate@localhost:5432/daymate_test'

export function setupTestApp(opts: { rateLimit?: boolean; asr?: AppDeps['asr']; llm?: AppDeps['llm']; quota?: AppDeps['quota']; push?: AppDeps['push'] } = {}) {
  const { db, pg, ping } = createDb(url)
  const mails: Mail[] = []
  const mailer: Mailer = { send: async (m) => void mails.push(m) }
  const app = buildApp({
    version: 'test',
    pingDb: ping,
    auth: {
      db,
      mailer,
      jwtSecret: 'test-secret-test-secret-test-secret',
      publicBaseUrl: 'https://daymate.test',
      cookieSecure: true,
      rateLimit: opts.rateLimit ?? false,
      asr: opts.asr ?? null,
      llm: opts.llm ?? null,
      push: opts.push ?? null,
      quota: opts.quota ?? { asrPerDay: 100, aiPerDay: 100 },
    },
  })
  return {
    app,
    db,
    mails,
    mailer,
    async reset() {
      mails.length = 0
      // 注册后台发验证邮件时还在写 email_tokens，清表可能撞上死锁：稍等重试
      for (let i = 0; ; i++) {
        try {
          await db.execute(sql`truncate users, user_sessions, email_tokens, calendars, events, tasks, entries, voice_logs, ai_calls, usage_daily, user_settings, reminders, notifications, notification_deliveries, push_subscriptions, daily_briefs cascade`)
          return
        } catch (err) {
          if (i >= 4 || (err as { cause?: { code?: string } }).cause?.code !== '40P01') throw err
          await new Promise((r) => setTimeout(r, 50))
        }
      }
    },
    async close() {
      await app.close()
      await pg.end()
    },
  }
}

export function refreshCookie(res: LightMyRequestResponse) {
  return res.cookies.find((c) => c.name === 'dm_rt')
}

/** 邮件正文里取出 token=xxx */
export function tokenFromMail(mail: Mail | undefined) {
  const m = mail?.text.match(/token=([\w-]+)/)
  if (!m) throw new Error('邮件里没有链接')
  return m[1]!
}

/** 等后台发送的邮件（注册后异步发） */
export async function waitForMail(mails: Mail[], count = 1) {
  for (let i = 0; i < 50 && mails.length < count; i++) await new Promise((r) => setTimeout(r, 20))
  return mails[count - 1]
}
