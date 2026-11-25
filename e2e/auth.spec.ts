import { expect, test } from '@playwright/test'
import { waitForLink } from './mailpit'

const id = Date.now().toString(36)
const user = { username: `e2e_${id}`, email: `e2e_${id}@example.com`, password: 'e2e-pass-1234' }

/** 邮件里的链接按 PUBLIC_BASE_URL 生成，换成当前测试地址的路径 */
const pathOf = (link: string) => new URL(link).pathname + new URL(link).search

test('注册 → 验证邮箱 → 改昵称 → 退出 → 邮箱登录 → 找回密码 → 新密码登录', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)

  await page.getByRole('link', { name: '注册一个' }).click()
  await page.getByLabel('用户名').fill(user.username)
  await page.getByLabel('邮箱').fill(user.email)
  await page.getByLabel('密码', { exact: true }).fill(user.password)
  await page.locator('label', { hasText: '我已阅读并同意' }).click({ position: { x: 8, y: 10 } })
  await page.getByRole('button', { name: '注册并登录' }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText(`，${user.username}`)).toBeVisible()
  await expect(page.getByText('邮箱还没验证')).toBeVisible()

  await page.goto(pathOf(await waitForLink(user.email, '验证你的 DayMate 邮箱')))
  await expect(page.getByText('邮箱验证成功')).toBeVisible()
  await page.getByRole('button', { name: '回到今天' }).click()
  await expect(page.getByText('邮箱还没验证')).toHaveCount(0)

  // 刷新页面：靠 HttpOnly Cookie 静默恢复登录
  await page.reload()
  await expect(page.getByText(`，${user.username}`)).toBeVisible()

  await page.goto('/me')
  await page.getByRole('button', { name: user.username }).click()
  await page.getByLabel('昵称').fill('测试君')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('测试君').first()).toBeVisible()
  await expect(page.getByText('本机')).toBeVisible()
  await page.screenshot({ path: 'test-results/me-page.png', fullPage: true })

  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goto('/me')
  await expect(page).toHaveURL(/\/login\?next=%2Fme$/)

  // 错误密码 → 通用提示；邮箱登录 → 回到原来要去的页面
  await page.getByLabel('用户名或邮箱').fill(user.email.toUpperCase())
  await page.getByLabel('密码', { exact: true }).fill('wrong-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByText('账号或密码错误')).toBeVisible()
  await page.getByLabel('密码', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).toHaveURL(/\/me$/)

  await page.getByRole('button', { name: '退出登录' }).click()
  await page.getByRole('link', { name: '忘记密码？' }).click()
  await page.getByLabel('邮箱').fill(user.email)
  await page.getByRole('button', { name: '发送重置链接' }).click()
  await expect(page.getByText('重置链接已经发过去了')).toBeVisible()

  await page.goto(pathOf(await waitForLink(user.email, '重置你的 DayMate 密码')))
  await page.getByLabel('新密码').fill('e2e-new-pass-5678')
  await page.getByLabel('再输一次').fill('e2e-new-pass-5678')
  await page.getByRole('button', { name: '确认修改' }).click()
  await expect(page.getByText('密码已重置')).toBeVisible()

  await page.getByLabel('用户名或邮箱').fill(user.username)
  await page.getByLabel('密码', { exact: true }).fill('e2e-new-pass-5678')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByText('测试君')).toBeVisible()
})

test('注册表单：前端即时校验，用户名重复时标在对应输入框', async ({ page }) => {
  await page.goto('/register')
  await page.getByRole('button', { name: '注册并登录' }).click()
  await expect(page.getByText('用户名 4–20 位，字母开头，只能有')).toBeVisible() // 错误替换了灰色提示
  await expect(page.getByText('请先阅读并同意')).toBeVisible()

  await page.getByLabel('用户名').fill(user.username)
  await page.getByLabel('邮箱').fill(`other_${id}@example.com`)
  await page.getByLabel('密码', { exact: true }).fill('12345678')
  await expect(page.getByText('这个密码太常见了')).toBeVisible()
  await page.getByLabel('密码', { exact: true }).fill('fine-pass-4321')
  await page.locator('label', { hasText: '我已阅读并同意' }).click({ position: { x: 8, y: 10 } })
  await page.getByRole('button', { name: '注册并登录' }).click()
  await expect(page.getByText('这个用户名已经被用了')).toBeVisible()
  await page.screenshot({ path: 'test-results/register-error.png', fullPage: true })
})
