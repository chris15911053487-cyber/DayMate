import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import type { Db } from '../../db/client.ts'
import { emailTokens } from '../../db/schema.ts'
import { randomToken, sha256 } from '../../lib/secrets.ts'

const TTL_MS = { verify: 24 * 3600_000, reset: 30 * 60_000 } as const
type Purpose = keyof typeof TTL_MS

/** 发新令牌前先作废同用途的旧令牌，邮箱里只有最新一封有效 */
export async function issueEmailToken(db: Db, userId: string, purpose: Purpose) {
  const token = randomToken()
  await db.transaction(async (tx) => {
    await tx
      .update(emailTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(emailTokens.userId, userId), eq(emailTokens.purpose, purpose), isNull(emailTokens.usedAt)))
    await tx.insert(emailTokens).values({
      userId,
      purpose,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + TTL_MS[purpose]),
    })
  })
  return token
}

/** 用掉一个令牌：有效则标记已用并返回用户 id，否则返回 null */
export async function consumeEmailToken(db: Db, token: string, purpose: Purpose) {
  const [row] = await db
    .update(emailTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(emailTokens.tokenHash, sha256(token)),
        eq(emailTokens.purpose, purpose),
        isNull(emailTokens.usedAt),
        gt(emailTokens.expiresAt, new Date()),
      ),
    )
    .returning({ userId: emailTokens.userId })
  return row?.userId ?? null
}

/** 最近一封同用途邮件的发送时间，用于限制重发频率 */
export async function lastIssuedAt(db: Db, userId: string, purpose: Purpose) {
  const [row] = await db
    .select({ createdAt: emailTokens.createdAt })
    .from(emailTokens)
    .where(and(eq(emailTokens.userId, userId), eq(emailTokens.purpose, purpose)))
    .orderBy(desc(emailTokens.createdAt))
    .limit(1)
  return row?.createdAt ?? null
}
