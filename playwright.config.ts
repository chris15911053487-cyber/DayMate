import { defineConfig, devices } from '@playwright/test'

/**
 * 端到端测试：需要先起好 数据库 + Mailpit（npm run dev:deps）和前后端（后端要配 SMTP_HOST=localhost SMTP_PORT=1025）。
 * 本机反复跑时后端加 RATE_LIMIT=off，否则会碰到注册限流（每 IP 每小时 5 次）。
 * E2E_BASE_URL 可指向 Docker 部署（https://localhost:3101）。默认用本机 Chrome，不用单独下载浏览器。
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    ignoreHTTPSErrors: true,
    channel: 'chrome',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'mobile', use: { ...devices['iPhone 14'], channel: 'chrome', defaultBrowserType: 'chromium', locale: 'zh-CN', timezoneId: 'Asia/Shanghai' } }],
})
