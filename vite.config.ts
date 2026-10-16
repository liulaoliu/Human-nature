import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// 这个插件用 node:fs 写文件，放在 .mjs 里避免把 Node 类型塞进前端 tsconfig
// @ts-expect-error .mjs 没有类型声明
import { projectStatePlugin } from './tools/vite-state-endpoint.mjs'
// @ts-expect-error .mjs 没有类型声明
import { fishStaticPlugin } from './tools/vite-fish-endpoint.mjs'
// @ts-expect-error .mjs 没有类型声明
import { ttsEndpointPlugin } from './tools/vite-tts-endpoint.mjs'
// @ts-expect-error .mjs 没有类型声明
import { aiEndpointPlugin } from './tools/vite-ai-endpoint.mjs'

export default defineConfig({
  plugins: [react(), projectStatePlugin(), fishStaticPlugin(), ttsEndpointPlugin(), aiEndpointPlugin()],
  base: './',
  build: {
    rollupOptions: {
      input: ['index.html', 'reader.html'],
    },
  },
  server: {
    // 端口固定死，别让 vite 在占用时自动换到 5174。
    // 录音存在 IndexedDB 里，而 IndexedDB（连同麦克风授权）是**按来源**隔离的——
    // 端口一变就换了来源，之前录的音会「看不见」（还在，只是挂在另一个来源下），
    // 麦克风也要重新授权。strictPort 让端口占用时直接报错，而不是悄悄换。
    port: 5173,
    strictPort: true,
  },
  preview: { port: 5173, strictPort: true },
  test: {
    globals: true,
    environment: 'node',
    // 组件 / 钩子测试用 `// @vitest-environment jsdom` 单独打开。
    // 必须给个真实 origin：不给的话 jsdom 的**不透明来源**会让 localStorage 取值抛
    // SecurityError，vitest 于是干脆不把它挂到全局上（表现为「没有 localStorage」）。
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
  },
})
