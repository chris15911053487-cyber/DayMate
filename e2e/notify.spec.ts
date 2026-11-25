import { expect, test } from '@playwright/test'
import { registerNewUser } from './helpers'

/** 北京时间"现在 + n 分钟"的日期和时间 */
function shanghai(minutesFromNow: number) {
  const d = new Date(Date.now() + 8 * 3600_000 + minutesFromNow * 60_000).toISOString()
  return { date: d.slice(0, 10), time: d.slice(11, 16) }
}

test('提醒与推送设置；测试通知进消息中心、铃铛显示未读', async ({ page }) => {
  await registerNewUser(page, 'ntf')
  await page.goto('/me')
  await page.getByRole('link', { name: '提醒与推送' }).click()
  await expect(page.getByRole('heading', { name: '提醒与推送' })).toBeVisible()

  await page.getByLabel('早报时间').fill('08:15')
  await page.getByRole('switch', { name: '早报和晚间复盘：邮件' }).click()
  await page.reload()
  await expect(page.getByLabel('早报时间')).toHaveValue('08:15')
  await expect(page.getByRole('switch', { name: '早报和晚间复盘：邮件' })).toHaveAttribute('aria-checked', 'true')

  await page.getByRole('button', { name: '发一条测试通知' }).click()
  await expect(page.locator('[aria-label="1 条未读"]:visible')).toBeVisible()
  await page.getByRole('link', { name: '消息' }).click()
  await page.getByRole('button', { name: /测试通知/ }).click()
  await expect(page.locator('[aria-label="1 条未读"]:visible')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/settings.png', fullPage: true })
})

test('到点提醒：日程开始前 5 分钟，页面里弹出提醒，消息中心有记录', async ({ page }) => {
  test.setTimeout(90_000)
  await registerNewUser(page, 'rmd')
  // 3 分钟后开始、提前 5 分钟提醒 → 提醒时间已过但日程还没开始 → 下一轮调度（≤30 秒）立即提醒
  const s = shanghai(3)
  await page.goto(`/calendar?view=month&date=${s.date}`)
  await page.getByRole('button', { name: '新建' }).click()
  await page.getByLabel('标题').fill('马上开会')
  await page.getByLabel('开始时间').fill(s.time)
  await page.getByLabel('提醒').selectOption('5')
  await page.getByRole('button', { name: '保存' }).click()

  // 页内提醒（未读数每分钟取一次，等最多 75 秒）
  await expect(page.getByRole('status').filter({ hasText: '马上开会' })).toBeVisible({ timeout: 75_000 })
  await page.getByRole('button', { name: '查看' }).click()
  await expect(page).toHaveURL(/\/calendar\?view=day/)
  await page.goto('/inbox')
  await expect(page.getByRole('button', { name: /马上开会/ })).toBeVisible()
})

test('今天页：让 AI 写早报或复盘（真实模型）', async ({ page }) => {
  test.setTimeout(60_000)
  await registerNewUser(page, 'brf')
  await page.getByLabel('添加待办').fill('交季度报告')
  await page.getByLabel('添加待办').press('Enter')
  await page.getByRole('button', { name: /让 AI 写今天的/ }).click()
  await expect(page.getByText(/AI 早报|今日复盘/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/季度报告/).first()).toBeVisible()
  await page.screenshot({ path: 'test-results/brief.png' })
})
