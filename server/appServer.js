import { createServer } from 'node:http'
import { existsSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequestHandler, loadPort } from './httpApp.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const distDir = join(root, 'dist')
const publicDir = join(root, 'public')
const fishDir = join(root, 'assets', 'imgs', 'fish')
const port = loadPort(root, process.argv[2])
const pidFile = join(here, '.appServer.pid')

if (!existsSync(join(distDir, 'index.html'))) {
  console.error('缺少构建产物 dist/index.html。请先运行 `npm run build`（或双击 构建.cmd）。')
  process.exit(1)
}

writeFileSync(pidFile, String(process.pid), 'utf8')
process.on('exit', () => {
  try {
    rmSync(pidFile, { force: true })
  } catch {
    // ignore
  }
})

const server = createServer(createRequestHandler({ distDir, publicDir, fishDir }))
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`端口 ${port} 被占用：可能是开发服务器（npm run dev）还在跑，先关掉它，或运行 停止服务.cmd。`)
  } else {
    console.error(`启动失败（端口 ${port}）：${e.message}`)
  }
  process.exit(1)
})
server.listen(port, () => {
  console.log(`学吧老哥 服务已启动： http://localhost:${port}/`)
  console.log(`  精读页： http://localhost:${port}/reader.html`)
})
