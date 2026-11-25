import type { Page } from '@playwright/test'

/** 走界面注册一个新用户并进入首页 */
export async function registerNewUser(page: Page, prefix = 'e2e') {
  const id = Date.now().toString(36) + Math.floor(Math.random() * 1000)
  const user = { username: `${prefix}_${id}`, email: `${prefix}_${id}@example.com`, password: 'e2e-pass-1234' }
  await page.goto('/register')
  await page.getByLabel('用户名').fill(user.username)
  await page.getByLabel('邮箱').fill(user.email)
  await page.getByLabel('密码', { exact: true }).fill(user.password)
  await page.locator('label', { hasText: '我已阅读并同意' }).click({ position: { x: 8, y: 10 } })
  await page.getByRole('button', { name: '注册并登录' }).click()
  await page.waitForURL(/\/$/)
  return user
}

/** 北京时间的今天 */
export function todayInShanghai(offsetDays = 0) {
  const d = new Date(Date.now() + 8 * 3600_000 + offsetDays * 86400_000)
  return d.toISOString().slice(0, 10)
}
