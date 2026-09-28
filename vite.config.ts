import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
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
  },
})
