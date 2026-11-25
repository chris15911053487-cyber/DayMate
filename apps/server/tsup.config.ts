import { defineConfig } from 'tsup'

// 打成单文件；@daymate/shared 是 TS 源码包，必须打进来，其余依赖在运行镜像里 npm 安装
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: ['@daymate/shared'],
})
