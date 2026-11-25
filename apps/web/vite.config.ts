import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    // 开发时 /api 转给本机后端（后端自己会去掉 /api 前缀）
    proxy: { '/api': process.env.API_PROXY_TARGET || 'http://localhost:3100' },
  },
})
