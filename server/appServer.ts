import { createServer } from 'node:http'
import { existsSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequestHandler, loadPort } from './httpApp.ts'

// 版本守卫：Node 原生 type stripping 需要 >= 23.6（BACKEND-TS-MIGRATION §2）。
// 低于这个版本时 `node server/appServer.ts` 会静默当 JS 解析、语法报错难排查，
// 这里给一个明确的、可读的错误。
const major = Number(process.versions.node.split('.')[0])
const minor = Number(process.versions.node.split('.')[1] ?? 0)
if (major < 23 || (major === 23 && minor < 6)) {
  console.error('需要 Node >= 23.6（原生 TypeScript type stripping）')
  process.exit(1)
}

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

const server = createServer(
  createRequestHandler({
    distDir,
    publicDir,
    fishDir,
    dbPath: process.env.XUEBA_DB || join(root, 'data', 'xueba.db'),
  }),
)
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`端口 ${port} 被占用：可能是开发服务器（npm run dev）还在跑，先关掉它，或运行 停止服务.cmd。`)
  } else {
    console.error(`启动失败（端口 ${port}）：${e.message}`)
  }
  process.exit(1)
})
// 只监听本机：SQLite 数据接口没有登录态，不能对局域网开放。
server.listen(port, '127.0.0.1', () => {
  console.log(`学吧老哥 服务已启动： http://localhost:${port}/`)
  console.log(`  精读页： http://localhost:${port}/reader`)
  console.log(`  数据：   ${process.env.XUEBA_DB || join(root, 'data', 'xueba.db')}`)
})
