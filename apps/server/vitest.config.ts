import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 接口测试共用一个测试库，按文件串行跑
    fileParallelism: false,
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 20_000,
  },
})
