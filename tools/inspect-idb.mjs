#!/usr/bin/env node
/**
 * 读浏览器 IndexedDB 里的词库，排查「某个词的 SRS 为什么不对」。
 *
 * 为什么需要它：
 * - 词库是一整条大 JSON（items 上万条），DevTools 里翻不动；
 * - SQLite 是主存，但服务没起 / 写失败时，最新数据只在 IndexedDB；
 * - 要按 interval / due 排序、按文章筛词、按单词查复习状态，脚本比手翻快。
 *
 * 做法：把 Chrome/Edge 的 IndexedDB 目录复制到临时 profile，起一个 headless
 * 浏览器，用同 origin 的页面通过 CDP 只读地取 IndexedDB。原库不会被改。
 *
 * 最关键的坑：Chrome 的 IndexedDB 是**两个目录**——
 *   <origin>.indexeddb.leveldb/  和  <origin>.indexeddb.blob/
 * 只拷 leveldb 会报 `NotReadableError: Data lost due to missing file`。
 *
 * 用法和排查口径见 docs/IDB-INSPECT.md。
 */
import { spawn, spawnSync } from 'node:child_process'
import { createServer as createHttpServer } from 'node:http'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LOCAL = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')

const argv = process.argv.slice(2)
const has = (name) => argv.includes(name)
function option(name, fallback) {
  const withEquals = argv.find((a) => a.startsWith(`${name}=`))
  if (withEquals) return withEquals.slice(name.length + 1)
  const i = argv.indexOf(name)
  if (i < 0) return fallback
  const value = argv[i + 1]
  return value === undefined || value.startsWith('--') ? fallback : value
}
const num = (name, fallback) => {
  const raw = option(name, String(fallback))
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

const opts = {
  browser: option('--browser', 'chrome'),
  userDataDir: option('--user-data-dir'),
  profile: option('--profile', 'Default'),
  origin: option('--origin', 'http://localhost:5173'),
  db: option('--db', 'shadowing-vocab'),
  store: option('--store', 'library'),
  key: option('--key', 'library'),
  article: option('--article'),
  word: option('--word'),
  limit: num('--limit', 20),
  minInterval: num('--min-interval', 100),
  snapshots: num('--snapshots', 0),
  timeout: num('--timeout', 30) * 1000,
  dbFile: option('--db-file', process.env.XUEBA_DB || join(ROOT, 'data/xueba.db')),
  json: has('--json'),
  keep: has('--keep'),
  list: has('--list'),
  help: has('--help') || has('-h'),
}

if (opts.help) {
  console.log(`读浏览器 IndexedDB 里的词库 / SRS（只读）

用法：
  node tools/inspect-idb.mjs [选项]

常用：
  node tools/inspect-idb.mjs                         # 词库概况 + interval 最大的词
  node tools/inspect-idb.mjs --limit 50              # 多看几条
  node tools/inspect-idb.mjs --word commodity        # 精确查一个词的 reviewState
  node tools/inspect-idb.mjs --article saved:xxx     # 按文章筛已复习过的词
  node tools/inspect-idb.mjs --snapshots 3           # 顺带看最近 3 版快照
  node tools/inspect-idb.mjs --list                  # 列出所有 IDB / store
  node tools/inspect-idb.mjs --browser edge          # 读 Edge 而不是 Chrome
  node tools/inspect-idb.mjs --origin http://localhost:5174
  node tools/inspect-idb.mjs --json                  # 机器可读输出

选项：
  --browser chrome|edge     默认 chrome
  --user-data-dir <dir>    浏览器 User Data 根目录（默认按浏览器取）
  --profile <name>          profile 子目录，默认 Default
  --origin <url>            IDB 按 origin 隔离，默认 http://localhost:5173
  --db <name>               默认 shadowing-vocab
  --store <name>            默认 library
  --key <name>              默认 library
  --article <id|title>      从 data/xueba.db 读文章，按句子 lemma 筛已复习词
  --word <word>             精确查词（word / lemma）
  --limit <n>               表格最多几行，默认 20
  --min-interval <n>        interval 超过多少算可疑，默认 100
  --snapshots <n>           读最近 n 版词库快照（只返回摘要），默认 0
  --db-file <path>          SQLite 路径，默认 data/xueba.db
  --timeout <seconds>       CDP 单步超时，默认 30
  --json                    JSON 输出
  --keep                    保留临时 profile（调试用，含用户数据，别提交）
`)
  process.exit(0)
}

function defaultUserDataDir(browser) {
  if (browser === 'edge') return join(LOCAL, 'Microsoft', 'Edge', 'User Data')
  return join(LOCAL, 'Google', 'Chrome', 'User Data')
}

function findBrowser(browser) {
  const envPath = browser === 'edge' ? process.env.EDGE_PATH : process.env.CHROME_PATH
  const candidates = [
    envPath,
    ...(browser === 'edge'
      ? [
          join(LOCAL, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
          'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        ]
      : [
          join(LOCAL, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          'C:/Program Files/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        ]),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
  ].filter(Boolean)
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  throw new Error(`找不到 ${browser} 可执行文件；用 --browser 或 CHROME_PATH/EDGE_PATH 指定`)
}

/** Chrome 的 IndexedDB 目录名：协议_主机_端口.indexeddb */
function originDirName(origin) {
  const u = new URL(origin)
  const scheme = u.protocol.replace(':', '')
  const port = u.port || (scheme === 'https' ? '443' : '80')
  const portPart = (scheme === 'http' && port === '80') || (scheme === 'https' && port === '443') ? '0' : port
  return `${scheme}_${u.hostname}_${portPart}.indexeddb`
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const s = createHttpServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port
      s.close(() => resolvePort(port))
    })
  })
}

function isServing(origin) {
  return fetch(origin, { signal: AbortSignal.timeout(800) })
    .then((r) => {
      void r.body?.cancel()
      return true
    })
    .catch(() => false)
}

/** dev server 没起时，起一个空白同源服务，保证 IndexedDB 的 origin 对得上。 */
async function ensureOriginServer(origin) {
  if (await isServing(origin)) return null
  const u = new URL(origin)
  if (u.protocol !== 'http:') throw new Error(`dev server 没起，且不是 http origin，无法自建空白页：${origin}`)
  const port = Number(u.port || 80)
  const server = createHttpServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><meta charset="utf-8"><title>IDB inspect</title>')
  })
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(port, resolveListen)
  })
  return server
}

function copySnapshot(srcRoot, destRoot, originName) {
  const srcLevel = join(srcRoot, `${originName}.leveldb`)
  const srcBlob = join(srcRoot, `${originName}.blob`)
  if (!existsSync(srcLevel)) throw new Error(`找不到 IndexedDB 目录：${srcLevel}`)
  const destIndexed = join(destRoot, 'Default', 'IndexedDB')
  mkdirSync(destIndexed, { recursive: true })
  cpSync(srcLevel, join(destIndexed, `${originName}.leveldb`), { recursive: true })
  // 只拷 leveldb 会报 Data lost due to missing file；blob 目录是 IndexedDB 的外部大值。
  if (existsSync(srcBlob)) cpSync(srcBlob, join(destIndexed, `${originName}.blob`), { recursive: true })
}

function stopBrowser(child) {
  if (!child || !child.pid) return
  if (process.platform === 'win32') {
    // Chrome 会再拉一串子进程，只 kill 父进程会留下 headless 实例。
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  }
  try {
    child.kill('SIGKILL')
  } catch {
    // 进程可能已退出
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitForCdp(port, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`浏览器启动后立即退出（code ${child.exitCode}）`)
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (r.ok) return r.json()
    } catch {
      // 还没起来
    }
    await sleep(100)
  }
  throw new Error(`等 CDP 超时（${timeoutMs}ms）`)
}

function connectCdp(url, timeoutMs) {
  return new Promise((resolveWs, reject) => {
    if (typeof WebSocket === 'undefined') throw new Error('需要 Node ≥ 22（全局 WebSocket）')
    const ws = new WebSocket(url)
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error('连接 CDP WebSocket 超时'))
    }, timeoutMs)
    ws.addEventListener(
      'open',
      () => {
        clearTimeout(timer)
        resolveWs(ws)
      },
      { once: true },
    )
    ws.addEventListener(
      'error',
      () => {
        clearTimeout(timer)
        reject(new Error('连接 CDP WebSocket 失败'))
      },
      { once: true },
    )
  })
}

function makeCdp(ws, timeoutMs) {
  let seq = 0
  const pending = new Map()
  const events = new Map()
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id) {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      clearTimeout(p.timer)
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result)
      return
    }
    const list = events.get(msg.method)
    if (list?.length) list.shift()(msg.params)
  })
  const send = (method, params = {}) =>
    new Promise((resolveSend, reject) => {
      const id = ++seq
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`CDP ${method} 超时（${timeoutMs}ms）`))
      }, timeoutMs)
      pending.set(id, { resolve: resolveSend, reject, timer })
      ws.send(JSON.stringify({ id, method, params }))
    })
  const once = (method) =>
    new Promise((resolveEvent) => {
      const list = events.get(method) ?? []
      list.push(resolveEvent)
      events.set(method, list)
    })
  return { send, once }
}

/**
 * 这段函数会被 toString() 后放进浏览器执行，只能用浏览器 API。
 * 返回的是精简后的诊断数据，不把整库 JSON 传回来。
 */
function pageRead(config) {
  const {
    dbName,
    store,
    key,
    articleId,
    articleTitle,
    articleLemmas,
    wordKeys,
    limit,
    minInterval,
    snapshotCount,
    listOnly,
  } = config

  const openDb = (name) =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open(name)
      req.onerror = () => reject(req.error || new Error('open failed'))
      req.onblocked = () => reject(new Error('IndexedDB blocked'))
      req.onsuccess = () => resolve(req.result)
    })
  const getValue = (db, storeName, recordKey) =>
    new Promise((resolve, reject) => {
      const req = db.transaction(storeName, 'readonly').objectStore(storeName).get(recordKey)
      req.onerror = () => reject(req.error || new Error('get failed'))
      req.onsuccess = () => resolve(req.result)
    })
  const getAllKeys = (db, storeName) =>
    new Promise((resolve, reject) => {
      const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAllKeys()
      req.onerror = () => reject(req.error || new Error('getAllKeys failed'))
      req.onsuccess = () => resolve(req.result || [])
    })
  const slim = (it) => ({
    id: it.id,
    word: it.word,
    lemma: it.lemma,
    kind: it.kind,
    interval: it.reviewState?.interval ?? null,
    due: it.reviewState?.due ?? null,
    ease: it.reviewState?.ease ?? null,
    reps: it.reviewState?.repetitions ?? null,
    lapses: it.reviewState?.lapses ?? null,
    relearn: it.reviewState?.relearn ?? null,
    updatedAt: it.updatedAt,
    source: it.source
      ? {
          articleId: it.source.articleId,
          fileName: it.source.fileName,
          sentenceId: it.source.sentenceId,
        }
      : null,
    contexts: (it.contexts || []).map((c) => c.articleId).filter(Boolean).slice(0, 5),
  })
  const brief = (it) => ({
    word: it.word,
    lemma: it.lemma,
    interval: it.reviewState?.interval ?? null,
    due: it.reviewState?.due ?? null,
    reps: it.reviewState?.repetitions ?? null,
    updatedAt: it.updatedAt,
  })
  const intervalOf = (it) => Number(it.reviewState?.interval ?? 0)
  const byInterval = (a, b) => intervalOf(b) - intervalOf(a)
  const isSuspicious = (it) => {
    const interval = intervalOf(it)
    if (interval >= minInterval) return true
    const due = it.reviewState?.due
    if (!due) return false
    const year = new Date(due).getFullYear()
    return Number.isFinite(year) && year > new Date().getFullYear() + 5
  }

  return (async () => {
    const databases = await indexedDB.databases()
    const names = databases.map((d) => d.name).filter(Boolean)

    if (listOnly) {
      const out = []
      for (const info of databases) {
        if (!info.name) continue
        try {
          const db = await openDb(info.name)
          out.push({ name: info.name, version: db.version, stores: [...db.objectStoreNames] })
          db.close()
        } catch (error) {
          out.push({ name: info.name, error: String(error?.message || error) })
        }
      }
      return { databases: out }
    }

    if (!names.includes(dbName)) return { error: 'DB_NOT_FOUND', databases: names }
    const db = await openDb(dbName)
    const stores = [...db.objectStoreNames]
    if (!stores.includes(store)) {
      db.close()
      return { error: 'STORE_NOT_FOUND', databases: names, stores }
    }
    const library = await getValue(db, store, key)
    if (!library) {
      db.close()
      return { error: 'KEY_NOT_FOUND', key, databases: names, stores }
    }

    const items = Array.isArray(library.items) ? library.items : []
    const articleSet = new Set(articleLemmas)
    const reviewedInArticle = articleId
      ? items
          .filter((it) => (it.reviewState?.repetitions ?? 0) > 0 && articleSet.has(it.lemma))
          .sort(byInterval)
          .slice(0, limit)
          .map(slim)
      : []
    const directInArticle = articleId
      ? items
          .filter(
            (it) =>
              it.source?.articleId === articleId ||
              (it.contexts || []).some((c) => c.articleId === articleId),
          )
          .sort(byInterval)
          .slice(0, limit)
          .map(slim)
      : []
    const wordMatches =
      wordKeys.length > 0
        ? items
            .filter((it) => wordKeys.includes(it.lemma) || wordKeys.includes(String(it.word || '').toLowerCase()))
            .sort(byInterval)
            .slice(0, limit)
            .map(slim)
        : []

    const articleEntries = library.articleEntries?.[articleId]
    const entriesCount = Array.isArray(articleEntries)
      ? articleEntries.length
      : articleEntries && typeof articleEntries === 'object'
        ? Object.keys(articleEntries).length
        : 0

    const snapshots = []
    if (snapshotCount > 0 && stores.includes('snapshots')) {
      const keys = (await getAllKeys(db, 'snapshots')).sort()
      for (const at of keys.slice(-snapshotCount)) {
        const snap = await getValue(db, 'snapshots', at)
        const snapItems = Array.isArray(snap?.items) ? snap.items : []
        snapshots.push({
          at,
          itemCount: snapItems.length,
          suspiciousCount: snapItems.filter(isSuspicious).length,
          top: snapItems.slice().sort(byInterval).slice(0, 3).map(brief),
        })
      }
    }

    db.close()
    return {
      db: dbName,
      store,
      key,
      schemaVersion: library.schemaVersion ?? null,
      itemCount: items.length,
      articleEntriesCount: Object.keys(library.articleEntries || {}).length,
      tombstones: Array.isArray(library.tombstones) ? library.tombstones.length : 0,
      suspicious: items.filter(isSuspicious).sort(byInterval).slice(0, limit).map(slim),
      top: items.slice().sort(byInterval).slice(0, limit).map(slim),
      wordMatches,
      article: articleId
        ? {
            id: articleId,
            title: articleTitle,
            lemmaCount: articleLemmas.length,
            entriesCount,
            reviewed: reviewedInArticle,
            direct: directInArticle,
          }
        : null,
      snapshots,
    }
  })()
}

/** 从 SQLite 的文章 payload 里取句子，生成 lemma 集合，给 --article 用。 */
async function loadArticleContext(article) {
  if (!existsSync(opts.dbFile)) throw new Error(`找不到 SQLite：${opts.dbFile}`)
  const { DatabaseSync } = await import('node:sqlite')
  const { lemmaOf } = await import('../src/core/vocab/word.ts')
  const db = new DatabaseSync(opts.dbFile)
  try {
    const row = db
      .prepare('SELECT id, payload FROM articles WHERE id = ? OR title = ? LIMIT 1')
      .get(article, article)
    if (!row) throw new Error(`文章不存在：${article}`)
    const payload = JSON.parse(row.payload)
    const text = (payload.sentences || []).map((s) => s.text).join('\n')
    const tokens = text.match(/[A-Za-z][A-Za-z'’-]*/g) ?? []
    const lemmas = [...new Set(tokens.map((t) => lemmaOf(t)).filter(Boolean))]
    return { id: row.id, title: payload.title || row.id, lemmas }
  } finally {
    db.close()
  }
}

async function wordKeysOf(word) {
  const { lemmaOf, normalizeWord } = await import('../src/core/vocab/word.ts')
  const normalized = normalizeWord(word)
  return [...new Set([normalized, lemmaOf(word)].filter(Boolean))]
}

function fmtDate(value) {
  if (!value) return '-'
  return String(value).slice(0, 10)
}

function printRows(rows) {
  if (!rows.length) {
    console.log('  （无）')
    return
  }
  const header = ['interval', 'due', 'word', 'reps', 'lapses', 'updated', 'source']
  const data = rows.map((it) => [
    String(it.interval ?? '-'),
    fmtDate(it.due),
    String(it.word ?? ''),
    String(it.reps ?? '-'),
    String(it.lapses ?? '-'),
    fmtDate(it.updatedAt),
    it.source?.articleId || it.contexts?.[0] || '-',
  ])
  const widths = header.map((h, i) => Math.max(h.length, ...data.map((r) => [...r[i]].length)))
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ')
  console.log('  ' + line(header))
  for (const row of data) console.log('  ' + line(row))
}

function printResult(result) {
  if (result.error) {
    console.error(`读取失败：${result.error}`)
    if (result.databases) console.error(`可用数据库：${result.databases.join(', ') || '（空）'}`)
    if (result.stores) console.error(`可用 store：${result.stores.join(', ') || '（空）'}`)
    process.exitCode = 1
    return
  }
  if (result.databases) {
    console.log('IndexedDB / object stores：')
    for (const db of result.databases) {
      console.log(`  ${db.name} v${db.version ?? '?'}  ${(db.stores || []).join(', ') || db.error}`)
    }
    return
  }

  console.log(`\n${result.db} / ${result.store} / ${result.key}`)
  console.log(`  items=${result.itemCount}  articleEntries=${result.articleEntriesCount}  tombstones=${result.tombstones}`)
  console.log(`\n可疑 SRS（interval ≥ ${opts.minInterval} 或 due 超过 5 年）：${result.suspicious.length} 条`)
  printRows(result.suspicious)
  console.log('\ninterval 最大的词：')
  printRows(result.top)

  if (result.wordMatches.length) {
    console.log('\n单词精确匹配：')
    printRows(result.wordMatches)
  }
  if (result.article) {
    const a = result.article
    console.log(`\n文章 ${a.id} · ${a.title}`)
    console.log(`  lemma=${a.lemmaCount}  articleEntries=${a.entriesCount}`)
    console.log(`  按来源/语境直接命中：${a.direct.length} 条（显示前 ${opts.limit}）`)
    printRows(a.direct)
    console.log(`  文章词里已复习过的：${a.reviewed.length} 条（显示前 ${opts.limit}）`)
    printRows(a.reviewed)
  }
  if (result.snapshots.length) {
    console.log('\n最近快照：')
    for (const snap of result.snapshots) {
      const top = snap.top.map((it) => `${it.word}:${it.interval}`).join(', ')
      console.log(`  ${snap.at}  items=${snap.itemCount}  可疑=${snap.suspiciousCount}  top=${top}`)
    }
  }
}

function isTransient(error) {
  return /Data lost|NotReadableError|missing file/i.test(String(error?.message || error))
}

let work = null
let child = null
let server = null
let result = null
let lastError = null

try {
  const browser = findBrowser(opts.browser)
  const userDataDir = opts.userDataDir || defaultUserDataDir(opts.browser)
  const indexedRoot = join(userDataDir, opts.profile, 'IndexedDB')
  const originName = originDirName(opts.origin)
  const articleContext = opts.article ? await loadArticleContext(opts.article) : null
  const wordKeys = opts.word ? await wordKeysOf(opts.word) : []
  const config = {
    dbName: opts.db,
    store: opts.store,
    key: opts.key,
    articleId: articleContext?.id ?? null,
    articleTitle: articleContext?.title ?? null,
    articleLemmas: articleContext?.lemmas ?? [],
    wordKeys,
    limit: Math.max(1, opts.limit),
    minInterval: opts.minInterval,
    snapshotCount: Math.max(0, opts.snapshots),
    listOnly: opts.list,
  }
  const expression = `(${pageRead.toString()})(${JSON.stringify(config)})`

  const tempBase = process.env.INSPECT_IDB_TMP || (existsSync('I:/.cache/temp/opencode') ? 'I:/.cache/temp/opencode' : tmpdir())
  const maxAttempts = 3
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    work = mkdtempSync(join(tempBase, 'inspect-idb-'))
    try {
      copySnapshot(indexedRoot, work, originName)
      server = await ensureOriginServer(opts.origin)
      const port = await freePort()
      child = spawn(
        browser,
        [
          '--headless=new',
          '--disable-gpu',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-sync',
          '--disable-default-apps',
          '--remote-allow-origins=*',
          `--remote-debugging-port=${port}`,
          `--user-data-dir=${work}`,
          'about:blank',
        ],
        { stdio: 'ignore' },
      )

      await waitForCdp(port, child, opts.timeout)
      const targetResponse = await fetch(
        `http://127.0.0.1:${port}/json/new?${encodeURIComponent(`${opts.origin}/@vite/client`)}`,
        { method: 'PUT' },
      )
      if (!targetResponse.ok) throw new Error(`CDP 新建页面失败：HTTP ${targetResponse.status}`)
      const target = await targetResponse.json()
      if (!target.webSocketDebuggerUrl) throw new Error('CDP 没有返回 webSocketDebuggerUrl')
      const ws = await connectCdp(target.webSocketDebuggerUrl, opts.timeout)
      try {
        const cdp = makeCdp(ws, opts.timeout)
        await cdp.send('Page.enable')
        await cdp.send('Runtime.enable')
        const loaded = cdp.once('Page.loadEventFired')
        await cdp.send('Page.navigate', { url: `${opts.origin}/@vite/client` })
        await Promise.race([loaded, sleep(3000)])
        const evaluated = await cdp.send('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true,
        })
        if (evaluated.exceptionDetails) {
          const desc = evaluated.exceptionDetails.exception?.description || evaluated.exceptionDetails.text
          throw new Error(desc)
        }
        result = evaluated.result?.value
      } finally {
        ws.close()
      }
      break
    } catch (error) {
      lastError = error
      stopBrowser(child)
      child = null
      if (server) {
        await new Promise((r) => server.close(r))
        server = null
      }
      if (work) {
        try {
          rmSync(work, { recursive: true, force: true })
        } catch {
          // 删不掉就留给系统临时目录
        }
        work = null
      }
      if (!isTransient(error) || attempt === maxAttempts) throw error
      console.error(`IndexedDB 快照不一致（${error.message}），重试 ${attempt}/${maxAttempts}…`)
      await sleep(500)
    }
  }
} catch (error) {
  lastError = error
} finally {
  stopBrowser(child)
  child = null
  if (server) await new Promise((r) => server.close(r))
  server = null
  if (work && !opts.keep) {
    try {
      rmSync(work, { recursive: true, force: true })
    } catch {
      // 临时目录删不掉不影响结果
    }
  }
}

if (lastError) {
  console.error(`\n读取 IndexedDB 失败：${lastError.message}`)
  if (work && opts.keep) console.error(`临时 profile 保留在：${work}`)
  process.exitCode = 1
} else if (opts.json) {
  console.log(JSON.stringify(result ?? null, null, 2))
} else if (result) {
  printResult(result)
}
