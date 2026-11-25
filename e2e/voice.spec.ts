import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { registerNewUser } from './helpers'

/**
 * 语音全链路（真实百度识别 + 真实大模型）：Chrome 用假麦克风播放一段中文语音。
 * 需要：VOICE_WAV 指向 16k 单声道 wav（macOS：say -v Tingting -o a.aiff "……" && afconvert -f WAVE -d LEI16@16000 -c 1 a.aiff a.wav），
 * 后端配好 BAIDU_ASR_* 和 AI_*。没给 VOICE_WAV 时跳过。
 */
const wav = process.env.VOICE_WAV
test.skip(!wav || !existsSync(wav), '没有提供 VOICE_WAV')
test.use({
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`],
  },
  permissions: ['microphone'],
})

test('按住说话 → 百度识别 → AI 拆成日程和待办 → 改一下 → 保存 → 日历和待办里都有', async ({ page }) => {
  test.setTimeout(90_000)
  await registerNewUser(page, 'voice')

  const mic = page.getByRole('button', { name: '按住说话，轻点打字' }).last()
  const box = (await mic.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await expect(page.getByText('请说话')).toBeVisible()
  await page.waitForTimeout(Number(process.env.VOICE_HOLD_MS) || 10_000)
  await page.mouse.up()

  await expect(page.getByRole('dialog', { name: '我听到的' })).toBeVisible({ timeout: 20_000 })
  const heard = await page.getByLabel('要说的话').inputValue()
  console.log('识别结果：', heard)
  expect(heard).toMatch(/老王/)

  await expect(page.getByLabel('日程标题')).toBeVisible({ timeout: 30_000 })
  console.log('卡片：', await page.getByLabel('日程标题').inputValue(), '/', await page.getByLabel('待办内容').inputValue())
  await expect(page.getByLabel('日程标题')).toHaveValue(/老王/)
  await expect(page.getByLabel('待办内容')).toHaveValue(/报告/)
  await page.screenshot({ path: 'test-results/voice-cards.png', fullPage: true })

  await page.getByLabel('日程标题').fill('和老王开会（语音）')
  await page.getByRole('button', { name: /全部保存/ }).click()
  await expect(page.getByText(/已保存：和老王开会（语音）/)).toBeVisible()

  await page.goto('/tasks')
  await expect(page.getByText(/报告/)).toBeVisible()
  await page.goto('/search?q=' + encodeURIComponent('语音'))
  await expect(page.getByRole('button', { name: /和老王开会（语音）/ })).toBeVisible()
})
