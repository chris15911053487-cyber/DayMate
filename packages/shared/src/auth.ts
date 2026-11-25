import { z } from 'zod'

/** 账号规则见 docs/技术方案.md 5.1。前端表单和后端接口共用，保证提示一致。 */
export const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,19}$/
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 64

export const usernameSchema = z
  .string()
  .trim()
  .regex(USERNAME_RE, '用户名 4–20 位，字母开头，只能有字母、数字、下划线')

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('邮箱格式不对').max(254, '邮箱太长了'))

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `密码至少 ${PASSWORD_MIN} 位`)
  .max(PASSWORD_MAX, `密码最多 ${PASSWORD_MAX} 位`)

/** 常见弱密码（各大泄露榜单前列 + 中文用户常用的数字组合），命中即拒绝 */
const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '88888888', '66666666',
  '12341234', '11223344', '12344321', '123123123', '147258369', '123456abc', 'abc12345', 'abcd1234',
  'a1234567', 'a12345678', 'aa123456', 'qq123456', 'qwer1234', 'qwerty123', 'qwertyui', 'asdf1234',
  'asdfghjk', 'zxcvbnm1', '1qaz2wsx', '1q2w3e4r', 'password', 'password1', 'passw0rd', 'iloveyou',
  'woaini1314', '5201314a', '52013145', 'admin123', 'admin888', 'letmein1', 'welcome1', 'sunshine',
  'princess', 'football', 'baseball', 'superman', 'whatever', 'trustno1', 'starwars', 'dragon12',
  'monkey12', 'p@ssw0rd', 'abcdefgh', 'abcdefg1', 'zxcvbnm123', 'qwe123456', 'q1w2e3r4',
])

/** 返回密码的问题描述；没问题返回 null。只做长度之外的检查（长度由 passwordSchema 管）。 */
export function passwordProblem(password: string, ctx: { username?: string; email?: string } = {}): string | null {
  const p = password.toLowerCase()
  if (COMMON_PASSWORDS.has(p)) return '这个密码太常见了，换一个吧'
  if (/^(.)\1+$/.test(p)) return '密码不能全是同一个字符'
  if (/^\d+$/.test(p) && isSequential(p)) return '密码不能是连续数字'
  if (ctx.username && p === ctx.username.toLowerCase()) return '密码不能和用户名相同'
  if (ctx.email && (p === ctx.email.toLowerCase() || p === ctx.email.toLowerCase().split('@')[0])) {
    return '密码不能和邮箱相同'
  }
  return null
}

function isSequential(digits: string) {
  const up = '01234567890123456789'
  const down = '98765432109876543210'
  return up.includes(digits) || down.includes(digits)
}

export const registerSchema = z
  .object({
    username: usernameSchema,
    email: emailSchema,
    password: passwordSchema,
    agree: z.literal(true, { error: '请先阅读并同意用户协议和隐私政策' }),
  })
  .superRefine((v, ctx) => {
    const problem = passwordProblem(v.password, v)
    if (problem) ctx.addIssue({ code: 'custom', path: ['password'], message: problem })
  })
export type RegisterInput = z.input<typeof registerSchema>

export const loginSchema = z.object({
  account: z.string().trim().min(1, '请输入用户名或邮箱').max(254),
  password: z.string().min(1, '请输入密码').max(PASSWORD_MAX),
  /** app / 小程序拿不到 HttpOnly Cookie，传 app 时刷新令牌放在响应体里 */
  client: z.enum(['web', 'app']).optional(),
})
export type LoginInput = z.input<typeof loginSchema>

export const forgotPasswordSchema = z.object({ email: emailSchema })
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema })
export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) })
export const refreshSchema = z.object({ refreshToken: z.string().max(300).optional() }).optional()

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, '请输入当前密码').max(PASSWORD_MAX),
  newPassword: passwordSchema,
})

export const deleteAccountSchema = z.object({ password: z.string().min(1, '请输入密码').max(PASSWORD_MAX) })

export const updateMeSchema = z.object({
  nickname: z.string().trim().max(30, '昵称最多 30 个字').nullable().optional(),
  timezone: z
    .string()
    .max(64)
    .refine(isValidTimeZone, '不认识的时区')
    .optional(),
})

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export interface Me {
  id: string
  username: string
  email: string
  emailVerified: boolean
  nickname: string | null
  timezone: string
  createdAt: string
  /** 申请注销后的冷静期：到 purgeAt 彻底删除，之前登录可撤销 */
  pendingDeletion: { purgeAt: string } | null
}

export interface AuthResult {
  accessToken: string
  /** 秒 */
  expiresIn: number
  user: Me
  /** 仅 client=app 时返回 */
  refreshToken?: string
}

export interface SessionInfo {
  id: string
  userAgent: string | null
  ip: string | null
  createdAt: string
  lastUsedAt: string
  current: boolean
}

export const ACCOUNT_DELETION_DAYS = 7
