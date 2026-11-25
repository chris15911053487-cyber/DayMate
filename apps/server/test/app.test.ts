import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { uuidv7 } from '../src/lib/uuid.ts'

describe('health', () => {
  it('/api/health 去掉前缀后命中，数据库正常返回 200', async () => {
    const app = buildApp({ version: 't', pingDb: async () => true })
    const res = await app.inject({ url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, db: 'up', version: 't' })
  })

  it('数据库不通返回 503', async () => {
    const app = buildApp({ version: 't', pingDb: async () => false })
    const res = await app.inject({ url: '/api/health' })
    expect(res.statusCode).toBe(503)
    expect(res.json().db).toBe('down')
  })
})

describe('SPA 回退', () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'daymate-web-'))
  fs.writeFileSync(path.join(dist, 'index.html'), '<html>app</html>')
  const app = buildApp({ version: 't', pingDb: async () => true, webDist: dist })

  it('页面地址返回 index.html', async () => {
    const res = await app.inject({ url: '/calendar', headers: { accept: 'text/html' } })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('app')
  })

  it('和接口同名的页面地址（/me）也返回页面，不会打到接口', async () => {
    const res = await app.inject({ url: '/me', headers: { accept: 'text/html' } })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('app')
  })

  it('不带 /api 的接口地址不再可用', async () => {
    const res = await app.inject({ url: '/health' })
    expect(res.statusCode).toBe(404)
  })

  it('静态文件按文件名返回', async () => {
    fs.writeFileSync(path.join(dist, 'robots.txt'), 'ok')
    const withFile = buildApp({ version: 't', pingDb: async () => true, webDist: dist })
    const res = await withFile.inject({ url: '/robots.txt' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('ok')
  })

  it('未知接口返回 JSON 404，不回退页面', async () => {
    const res = await app.inject({ url: '/api/nope', headers: { accept: 'text/html' } })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('uuidv7', () => {
  it('版本位为 7，且按时间递增', () => {
    const a = uuidv7(1000)
    const b = uuidv7(2000)
    expect(a[14]).toBe('7')
    expect(a < b).toBe(true)
  })
})
