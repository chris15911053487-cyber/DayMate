import { describe, expect, it } from 'vitest'
import { generateVAPIDKeys } from 'web-push'
import { createWebPush } from '../src/push/index.ts'

/** 用真实的 web-push 模块（其余测试用假的推送），防止库升级、导入方式变了没人发现 */
describe('Web Push 发送器', () => {
  it('没配密钥时不启用', () => {
    expect(createWebPush({ publicKey: '', privateKey: '', subject: 'mailto:a@b.c' })).toBeNull()
  })

  it('推送服务连不上时返回失败（不抛错），不当成订阅失效', async () => {
    const keys = generateVAPIDKeys()
    const sender = createWebPush({ ...keys, subject: 'mailto:a@b.c' })!
    expect(sender.publicKey).toBe(keys.publicKey)
    const r = await sender.send(
      { endpoint: 'http://127.0.0.1:9/push', p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
      { title: 't', body: 'b', url: '/', tag: 't', notificationId: 'n' },
    )
    expect(r).toMatchObject({ ok: false, gone: false })
  })
})
