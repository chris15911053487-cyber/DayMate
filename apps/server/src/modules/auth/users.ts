import { eq, sql } from 'drizzle-orm'
import { ACCOUNT_DELETION_DAYS, type Me } from '@daymate/shared'
import type { Db } from '../../db/client.ts'
import { users } from '../../db/schema.ts'

export type UserRow = typeof users.$inferSelect

export function toMe(u: UserRow): Me {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    emailVerified: !!u.emailVerifiedAt,
    nickname: u.nickname,
    timezone: u.timezone,
    createdAt: u.createdAt.toISOString(),
    pendingDeletion:
      u.status === 'deleting' && u.deletionRequestedAt
        ? { purgeAt: new Date(u.deletionRequestedAt.getTime() + ACCOUNT_DELETION_DAYS * 86400_000).toISOString() }
        : null,
  }
}

/** 带 @ 按邮箱查，否则按用户名查（不区分大小写） */
export async function findUserByAccount(db: Db, account: string) {
  const a = account.trim()
  const where = a.includes('@') ? eq(users.email, a.toLowerCase()) : sql`lower(${users.username}) = lower(${a})`
  const [u] = await db.select().from(users).where(where).limit(1)
  return u
}

export async function findUserById(db: Db, id: string) {
  const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1)
  return u
}

/** 当前用户的时区（日程、待办、记录的日期换算都按它） */
export async function userTimezone(db: Db, userId: string): Promise<string> {
  const [u] = await db.select({ tz: users.timezone }).from(users).where(eq(users.id, userId)).limit(1)
  return u?.tz ?? 'Asia/Shanghai'
}
