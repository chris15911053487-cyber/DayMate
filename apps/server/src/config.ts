import { randomBytes } from 'node:crypto'
import path from 'node:path'

const env = process.env
const isProd = env.NODE_ENV === 'production'

function jwtSecret() {
  if (env.JWT_SECRET) return env.JWT_SECRET
  if (isProd) throw new Error('生产环境必须设置 JWT_SECRET（至少 32 位随机字符串）')
  // 开发时每次启动随机生成：访问令牌随重启失效，前端会用刷新令牌自动换新的
  return randomBytes(32).toString('hex')
}

export const config = {
  // 开发默认 3100，避免和本机 online-report 的 3000 冲突；镜像里固定 3000
  port: Number(env.PORT) || (isProd ? 3000 : 3100),
  host: env.HOST || '0.0.0.0',
  isProd,
  version: env.APP_VERSION || '0.1.0',
  databaseUrl: env.DATABASE_URL || 'postgres://daymate:daymate@localhost:5432/daymate',
  /** 迁移 SQL 目录：开发时 cwd 是 apps/server，镜像里是 /app */
  migrationsDir: env.MIGRATIONS_DIR || path.resolve(process.cwd(), 'drizzle'),
  /** 前端构建产物；目录不存在时只提供接口（开发时由 Vite 提供页面） */
  webDist: env.WEB_DIST || path.resolve(process.cwd(), '../web/dist'),
  /** 邮件里的链接前缀 */
  publicBaseUrl: (env.PUBLIC_BASE_URL || 'http://localhost:5173').replace(/\/+$/, ''),
  jwtSecret: jwtSecret(),
  /** 本机反复跑端到端测试时可设 RATE_LIMIT=off；生产环境忽略这个开关 */
  rateLimit: isProd || env.RATE_LIMIT !== 'off',
  /** 刷新令牌 Cookie 是否只走 HTTPS；生产默认开 */
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProd,
  asr: {
    apiKey: env.BAIDU_ASR_API_KEY || '',
    secretKey: env.BAIDU_ASR_SECRET_KEY || '',
    /** standard（标准版 1537）| pro（极速版 80001，需在百度控制台单独开通） */
    mode: (env.BAIDU_ASR_MODE === 'pro' ? 'pro' : 'standard') as 'standard' | 'pro',
    devPid: Number(env.BAIDU_ASR_DEV_PID) || null,
    lmId: env.BAIDU_ASR_LM_ID || null,
  },
  ai: {
    baseUrl: (env.AI_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
    apiKey: env.AI_API_KEY || '',
    modelParse: env.AI_MODEL_PARSE || 'deepseek-chat',
    modelSummary: env.AI_MODEL_SUMMARY || env.AI_MODEL_PARSE || 'deepseek-chat',
    timeoutMs: Number(env.AI_TIMEOUT_MS) || 30_000,
  },
  vapid: {
    publicKey: env.VAPID_PUBLIC_KEY || '',
    privateKey: env.VAPID_PRIVATE_KEY || '',
    subject: env.VAPID_SUBJECT || 'mailto:admin@daymate.local',
  },
  quota: {
    asrPerDay: Number(env.QUOTA_ASR_PER_DAY) || 100,
    aiPerDay: Number(env.QUOTA_AI_PER_DAY) || 100,
  },
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT) || 587,
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || 'DayMate <no-reply@daymate.local>',
  },
}
export type Config = typeof config
