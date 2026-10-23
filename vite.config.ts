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
// @ts-expect-error .mjs 没有类型声明
import { storeEndpointPlugin } from './tools/vite-store-endpoint.mjs'

export default defineConfig({
  plugins: [
    react(),
    projectStatePlugin(),
    fishStaticPlugin(),
    ttsEndpointPlugin(),
    aiEndpointPlugin(),
    storeEndpointPlugin(),
  ],
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
    // data/ 里是 SQLite 的 db/wal/shm，写一次就变；不忽略会让 Vite 以为源码变了，
    // 页面自动刷新 → 自动保存 → 再刷新。data/tts 是 TTS 缓存（以前在 public 下，被拷进 dist），同理。
    watch: {
      ignored: ['**/data/**', '**/public/shadowing-state.json'],
      // **关键**：等文件写完再通知，别在「截断 / 写一半」的中间态就触发。
      //
      // 少了这一条会这样：某个 .ts 文件被改成空/半截状态的那一刻，chokidar 立刻发 change，
      // vite 当场把这个**空内容** transform 掉并缓存进模块图（key = 该文件的 HMR 时间戳）。
      // 之后文件写完了，但因为「文件大小/mtime 没再变」，模块图里那份空缓存不会被作废——
      // 浏览器请求该模块拿到 0 字节，ESM 解析失败，直接报
      //   `does not provide an export named 'xxx'`（整个页面白屏）。
      // 实测过一次（useAiPack.ts），`touch` 一下能救，但那是运气，不是机制。
      // 200ms 静默期足够覆盖「截断→写入」，又不至于让正常改代码的 HMR 变迟钝。
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    },
    // 别让 dev server 把 /data/xueba.db 当静态文件直接吐出去。
    fs: { deny: ['**/data/**'] },
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
