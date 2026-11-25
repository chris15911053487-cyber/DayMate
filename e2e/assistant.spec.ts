import { expect, test } from '@playwright/test'
import { registerNewUser } from './helpers'

/** 打字走同一套 AI 解析（真实大模型）；后端没配 AI 时会退回成"记录"，本用例要求配好 */
test('轻点语音按钮打字 → AI 拆卡片 → 换类型、删一张 → 保存；提问直接回答', async ({ page }) => {
  test.setTimeout(90_000)
  await registerNewUser(page, 'ai')

  await page.getByRole('button', { name: '按住说话，轻点打字' }).last().focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: '说点什么' })).toBeVisible()
  await page.getByLabel('要说的话').fill('明天上午十点去医院体检，记得买牛奶，今天读完了一本书')
  await page.getByRole('button', { name: '交给 AI' }).click()

  await expect(page.getByLabel('日程标题')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByLabel('待办内容')).toBeVisible()
  await expect(page.getByLabel('记录内容')).toBeVisible()
  await page.screenshot({ path: 'test-results/assistant-cards.png', fullPage: true })

  // 不要那条记录
  await page.getByRole('button', { name: '不要这一条' }).nth(2).click()
  await expect(page.getByLabel('记录内容')).toHaveCount(0)
  await page.getByRole('button', { name: '全部保存（2 条）' }).click()
  await expect(page.getByText(/已保存/)).toBeVisible()

  // 提问
  await page.getByRole('button', { name: '按住说话，轻点打字' }).last().focus()
  await page.keyboard.press('Enter')
  await page.getByLabel('要说的话').fill('明天有什么安排')
  await page.getByLabel('要说的话').press('Enter')
  await expect(page.getByText(/体检/)).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: 'test-results/assistant-answer.png' })
})
