import { eq } from 'drizzle-orm'
import { DEFAULT_SETTINGS, minutesOf, settingsSchema, type SettingsPatch, type UserSettings } from '@daymate/shared'
import type { Db } from '../../db/client.ts'
import { userSettings } from '../../db/schema.ts'

/** 存的设置和默认值合并（以后加了新字段，老用户自动拿到默认值） */
export function mergeSettings(stored: Partial<UserSettings> | null | undefined, patch: SettingsPatch = {}): UserSettings {
  const base = { ...DEFAULT_SETTINGS, ...(stored ?? {}) }
  const merged: UserSettings = {
    ...base,
    ...patch,
    channels: {
      reminder: { ...DEFAULT_SETTINGS.channels.reminder, ...base.channels?.reminder, ...patch.channels?.reminder },
      brief: { ...DEFAULT_SETTINGS.channels.brief, ...base.channels?.brief, ...patch.channels?.brief },
    },
  }
  return settingsSchema.parse(merged)
}

export async function getSettings(db: Db, userId: string): Promise<UserSettings> {
  const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1)
  return mergeSettings(row?.data)
}

export async function saveSettings(db: Db, userId: string, patch: SettingsPatch): Promise<UserSettings> {
  const next = mergeSettings(await getSettings(db, userId), patch)
  await db
    .insert(userSettings)
    .values({ userId, data: next })
    .onConflictDoUpdate({ target: userSettings.userId, set: { data: next, updatedAt: new Date() } })
  return next
}

/** 现在（用户时区的 'HH:mm'）是否在免打扰时段；时段可以跨午夜（23:00–07:00） */
export function inQuietHours(s: UserSettings, localTime: string): boolean {
  if (!s.quietHours.enabled) return false
  const t = minutesOf(localTime)
  const a = minutesOf(s.quietHours.start)
  const b = minutesOf(s.quietHours.end)
  return a <= b ? t >= a && t < b : t >= a || t < b
}
