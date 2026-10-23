// ============================================================
// check_dev_modules.mjs — dev server 健康检查：有没有模块被吐成空壳
//
// 起因（2026-10-23）：页面直接白了，F12 报
//   Uncaught SyntaxError: The requested module '/src/reader/hooks/useAiPack.ts?t=...'
//   does not provide an export named 'useAiPack'
// 而文件本身完好（23KB、tsc 过、esbuild 能转）。真实原因是 vite 模块图里缓存了一份
// **0 字节的 transform 结果**：文件被写到一半（截断态）时 watcher 就触发了，
// vite 当场把空内容转掉并缓存，之后文件写完了也不再重转。
//
// 这个脚本就是给这种故障一条命令的诊断：逐个请求 src/ 下的模块，报出空响应/非 200 的。
//
//   用法：npm run check:dev        （dev server 需已在跑，默认 5173）
//         VITE_PORT=5174 npm run check:dev
//
// 能查出来的：
//   - 模块响应体为空（上面那种白屏）
//   - 模块返回 500（语法错误 / 插件报错）
// 查不出来的：运行期 JS 报错、样式问题 —— 那些还是得看浏览器 console。
// ============================================================
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const PORT = Number(process.env.VITE_PORT || 5173)
// 用 localhost 而不是 127.0.0.1：本机 vite 只绑了 IPv6 的 ::1，
// 写死 127.0.0.1 会 connect ECONNREFUSED（明明服务在跑）。
const BASE = `http://localhost:${PORT}`
const ROOT = process.cwd()
const CONCURRENCY = 8

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue
      walk(p, out)
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

const files = walk(join(ROOT, 'src')).map((p) => relative(ROOT, p).replace(/\\/g, '/'))

async function probe(url) {
  const res = await fetch(url)
  const body = await res.text()
  return { status: res.status, size: body.length, body }
}

async function main() {
  try {
    await probe(`${BASE}/reader.html`)
  } catch {
    console.error(`❌ 连不上 ${BASE} —— dev server 没在跑？先 npm run dev`)
    process.exit(2)
  }

  const bad = []
  let checked = 0
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (f) => {
        try {
          const r = await probe(`${BASE}/${f}`)
          return { f, ...r }
        } catch (e) {
          return { f, status: 0, size: 0, body: String(e) }
        }
      }),
    )
    for (const r of results) {
      checked++
      // 空响应体是白屏的直接原因；非 200 是语法/插件错
      if (r.status !== 200 || r.size === 0) bad.push(r)
    }
  }

  if (!bad.length) {
    console.log(`✅ dev server 正常：${checked} 个模块都有内容`)
    return
  }

  console.error(`\n❌ ${bad.length} / ${checked} 个模块有问题（页面会白屏或报 "does not provide an export"）：\n`)
  for (const r of bad) {
    const why = r.status !== 200 ? `HTTP ${r.status}` : '响应体 0 字节'
    console.error(`  - ${r.f}  → ${why}`)
  }
  console.error(
    [
      '',
      '处理办法（任选其一）：',
      '  1) touch 那个文件（让 vite 重新 transform）：',
      `       bash -c "touch ${bad[0].f}"`,
      '  2) 重启 dev server（npm run dev）',
      '',
      '根因是 vite 在文件「写一半」时就触发了 transform 并缓存了空结果；',
      'vite.config.ts 里 server.watch.awaitWriteFinish 就是防这个的，别再删。',
    ].join('\n'),
  )
  process.exit(1)
}

main()
