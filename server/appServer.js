import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequestHandler, loadPort } from './httpApp.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const distDir = join(root, 'dist')
const publicDir = join(root, 'public')
const port = loadPort(root, process.argv[2])

if (!existsSync(join(distDir, 'index.html'))) {
  console.error('缺少构建产物 dist/index.html。请先运行 `npm run build`（或双击 构建.cmd）。')
  process.exit(1)
}

const server = createServer(createRequestHandler({ distDir, publicDir }))
server.on('error', (e) => {
  console.error(`启动失败（端口 ${port}）：${e.message}`)
  process.exit(1)
})
server.listen(port, () => {
  console.log(`跟读/精读 服务已启动： http://localhost:${port}/`)
  console.log(`  精读页： http://localhost:${port}/reader.html`)
})
