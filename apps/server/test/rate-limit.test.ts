import { afterAll, describe, expect, it } from 'vitest'
import { setupTestApp } from './helpers.ts'

const t = setupTestApp({ rateLimit: true })
afterAll(() => t.close())

describe('限流', () => {
  it('同一 IP 每分钟最多 10 次登录，超过返回中文提示', async () => {
    await t.reset()
    const codes: number[] = []
    for (let i = 0; i < 11; i++) {
      const res = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { account: 'x', password: 'y' } })
      codes.push(res.statusCode)
      if (i === 10) expect(res.json()).toMatchObject({ code: 'RATE_LIMITED' })
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true)
    expect(codes[10]).toBe(429)
  })
})
