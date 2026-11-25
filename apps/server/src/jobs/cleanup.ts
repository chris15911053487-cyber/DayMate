import { and, eq, lt, ne, or } from 'drizzle-orm'
import { ACCOUNT_DELETION_DAYS } from '@daymate/shared'
import type { Db } from '../db/client.ts'
import { aiCalls, calendars, notifications, reminders, emailTokens, entries, events, tasks, usageDaily, userSessions, users, voiceLogs } from '../db/schema.ts'

const DAY = 86400_000

/** 每小时一次：删掉冷静期已过的注销账号（其余数据随外键级联删除），清理过期会话、令牌和软删除超过 30 天的内容 */
export async function runCleanup(db: Db, now = new Date()) {
  const purged = await db
    .delete(users)
    .where(and(eq(users.status, 'deleting'), lt(users.deletionRequestedAt, new Date(now.getTime() - ACCOUNT_DELETION_DAYS * DAY))))
    .returning({ id: users.id })
  await db
    .delete(userSessions)
    .where(
      or(
        lt(userSessions.expiresAt, new Date(now.getTime() - 7 * DAY)),
        lt(userSessions.revokedAt, new Date(now.getTime() - 30 * DAY)),
      ),
    )
  await db.delete(emailTokens).where(lt(emailTokens.expiresAt, new Date(now.getTime() - 7 * DAY)))
  // 软删除超过 30 天的内容彻底删掉（记录先删，避免外键指向已删日程）
  const softCutoff = new Date(now.getTime() - 30 * DAY)
  await db.delete(entries).where(lt(entries.deletedAt, softCutoff))
  await db.delete(tasks).where(lt(tasks.deletedAt, softCutoff))
  await db.delete(events).where(lt(events.deletedAt, softCutoff))
  await db.delete(calendars).where(lt(calendars.deletedAt, softCutoff))
  // 识别记录保留 90 天、AI 调用记录 180 天、额度计数 30 天
  await db.delete(voiceLogs).where(lt(voiceLogs.createdAt, new Date(now.getTime() - 90 * DAY)))
  await db.delete(aiCalls).where(lt(aiCalls.createdAt, new Date(now.getTime() - 180 * DAY)))
  await db.delete(usageDaily).where(lt(usageDaily.day, new Date(now.getTime() - 30 * DAY).toISOString().slice(0, 10)))
  // 站内消息保留 180 天；发过的提醒 30 天
  await db.delete(notifications).where(lt(notifications.createdAt, new Date(now.getTime() - 180 * DAY)))
  await db.delete(reminders).where(and(lt(reminders.fireAt, new Date(now.getTime() - 30 * DAY)), ne(reminders.status, 'pending')))
  return { purgedUsers: purged.length }
}

export function startCleanupJob(db: Db, log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void }) {
  const tick = () =>
    runCleanup(db)
      .then((r) => r.purgedUsers && log.info(r, '已彻底删除注销账号'))
      .catch((err) => log.error({ err }, '清理任务失败'))
  const timer = setInterval(tick, 3600_000)
  timer.unref()
  void tick()
  return () => clearInterval(timer)
}
