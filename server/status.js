import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import http from 'node:http'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const DEFAULT_PORT = 5173

export function getPort(argPort) {
  if (argPort && /^\d+$/.test(argPort)) return Number(argPort)
  if (process.env.PORT && /^\d+$/.test(process.env.PORT)) return Number(process.env.PORT)
  try {
    const c = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'))
    if (c.port) return Number(c.port)
  } catch {
    // ignore
  }
  return DEFAULT_PORT
}

const PROBE_HOSTS = ['localhost', '127.0.0.1', '::1']

function fetchFromHost(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let done = false
    const finish = (v) => {
      if (!done) {
        done = true
        resolve(v)
      }
    }
    const req = http.get(
      { host, port, path: '/api/status', timeout: timeoutMs },
      (res) => {
        let data = ''
        res.on('data', (c) => {
          data += c
        })
        res.on('end', () => {
          try {
            finish(JSON.parse(data))
          } catch {
            finish(null)
          }
        })
        res.on('error', () => finish(null))
      },
    )
    req.on('timeout', () => {
      req.destroy()
      finish(null)
    })
    req.on('error', () => finish(null))
  })
}

/** GET /api/status；并行试 localhost / 127.0.0.1 / ::1（Vite 只绑 localhost 时也能探到）。 */
export async function fetchStatus(port, timeoutMs = 1500) {
  const results = await Promise.allSettled(PROBE_HOSTS.map((h) => fetchFromHost(h, port, timeoutMs)))
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) return r.value
  }
  return null
}

export function formatUptime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0))
  if (s < 60) return `${s} 秒`
  if (s < 3600) return `${Math.floor(s / 60)} 分钟`
  return `${Math.floor(s / 3600)} 小时`
}

const pad = (n) => String(n).padStart(2, '0')

export function printStatus(port, st) {
  console.log('跟读/精读 本地服务')
  if (!st) {
    console.log(`  状态: 未运行（端口 ${port} 无响应）`)
    return
  }
  console.log('  状态: 运行中')
  console.log(`  端口: ${port}`)
  console.log(`  地址: http://localhost:${port}/`)
  console.log(`  精读: http://localhost:${port}/reader.html`)
  console.log(`  PID : ${st.pid}`)
  console.log(`  运行: ${formatUptime(st.uptime)}`)
  if (st.time) {
    const d = new Date(st.time)
    console.log(
      `  时间: ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    )
  }
}

async function main() {
  const args = process.argv.slice(2)
  const quiet = args.includes('-q')
  const port = getPort(args.find((a) => /^\d+$/.test(a)))
  const st = await fetchStatus(port)
  if (quiet) process.exit(st ? 0 : 1)
  printStatus(port, st)
  process.exit(st ? 0 : 1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
