import { expect, test } from '@playwright/test'
import { registerNewUser, todayInShanghai } from './helpers'

test('今天页：添加待办并勾选完成；写一条带标签的记录', async ({ page }) => {
  await registerNewUser(page)
  await expect(page.getByText('今天没有安排。点「新建」')).toBeVisible()

  await page.getByLabel('添加待办').fill('买牛奶')
  await page.getByLabel('添加待办').press('Enter')
  await expect(page.getByRole('checkbox', { name: '完成：买牛奶' })).toBeVisible()
  await expect(page.getByText('还有 1 件待办')).toBeVisible()
  await page.getByRole('checkbox', { name: '完成：买牛奶' }).click()
  await expect(page.getByRole('checkbox', { name: '取消完成：买牛奶' })).toBeVisible()

  await page.getByLabel('写记录').fill('晚上跑了 5 公里 #运动')
  await page.getByRole('button', { name: '记下' }).click()
  await expect(page.getByText('#运动')).toBeVisible()
  await page.screenshot({ path: 'test-results/today.png', fullPage: true })
})

test('日历：新建每周重复的例会 → 下周也有 → 时间轴 → 改时区 → 搜索 → 删除并撤销', async ({ page }) => {
  await registerNewUser(page)
  const today = todayInShanghai()
  const nextWeek = todayInShanghai(7)

  await page.goto(`/calendar?view=month&date=${today}`)
  await page.getByRole('button', { name: '新建' }).click()
  await page.getByLabel('标题').fill('例会')
  await page.getByLabel('开始时间').fill('09:00')
  await page.getByLabel('重复', { exact: true }).selectOption('weekly')
  await page.getByLabel('地点').fill('3 楼会议室')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /例会/ })).toBeVisible()
  await expect(page.getByText('09:00–10:00')).toBeVisible()

  // 下周同一天也有
  await page.goto(`/calendar?view=month&date=${nextWeek}`)
  await expect(page.getByRole('button', { name: /例会/ })).toBeVisible()
  await page.screenshot({ path: 'test-results/month.png', fullPage: true })

  // 周视图里能看到，点开是重复日程的编辑
  await page.getByRole('radio', { name: '周' }).click()
  await page.getByRole('button', { name: /^例会/ }).first().click()
  await expect(page.getByText('这是重复日程')).toBeVisible()
  await page.getByRole('button', { name: '关闭' }).click()
  await page.screenshot({ path: 'test-results/week.png' })

  // 改成东京时区：同一场会显示成 10:00
  await page.goto('/me')
  await page.getByLabel('时区', { exact: true }).selectOption('Asia/Tokyo')
  await expect(page.getByText('已切换到东京时间')).toBeVisible()
  await page.goto(`/calendar?view=month&date=${nextWeek}`)
  await expect(page.getByText('10:00–11:00')).toBeVisible()

  // 搜索
  await page.goto('/search')
  await page.getByRole('textbox', { name: '搜索' }).fill('会议室')
  await expect(page.getByRole('button', { name: /例会/ })).toBeVisible()

  // 删除 → 撤销
  await page.getByRole('button', { name: /例会/ }).click()
  await page.getByRole('button', { name: '删除日程' }).click()
  await expect(page.getByText('已删除日程')).toBeVisible()
  await page.getByRole('button', { name: '撤销' }).click()
  await page.goto(`/calendar?view=month&date=${nextWeek}`)
  await expect(page.getByRole('button', { name: /例会/ })).toBeVisible()
})

test('日视图：点空白时间新建；表单校验结束时间', async ({ page }) => {
  await registerNewUser(page)
  const today = todayInShanghai()
  await page.goto(`/calendar?view=day&date=${today}`)
  await page.getByRole('button', { name: /14 点新建日程/ }).click()
  await expect(page.getByLabel('开始时间')).toHaveValue('14:00')
  await page.getByLabel('标题').fill('看牙')
  await page.getByLabel('结束时间').fill('13:00')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('结束时间要晚于开始时间')).toBeVisible()
  await page.getByLabel('结束时间').fill('15:30')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByRole('button', { name: /^看牙/ })).toBeVisible()
  await page.screenshot({ path: 'test-results/day.png' })
})
