/**
 * ai-core.mjs —— AI 批处理的共享内核（不依赖 DOM / React）。
 *
 * 三处复用：
 *   - tools/ai-pack.mjs（命令行 `npm run ai:pack`）
 *   - server/httpApp.js（生产：应用内「一键跑批」）
 *   - tools/vite-ai-endpoint.mjs（开发：npm run dev 下的同一接口）
 *
 * ⚠️ 安全：API key 只从**环境变量**或**本机私密文件 config.local.json** 读取。
 * 绝不从被 git 跟踪的 config.json 里读 key（那样会连 key 一起提交），
 * 也绝不把 key 回传给浏览器。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SYSTEM_PROMPT =
  '你是「学吧老哥」的 AI 批处理引擎。用户会给你一条已经写好的提示词，' +
  '请严格按提示词要求输出结果。只输出结果本身，不要解释、不要 Markdown 代码围栏。'

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 读取 AI 配置。优先级（后覆盖前）：
 *   config.json（被跟踪，**不应**放 key）
 *   < config.local.json（本机私密，已 gitignore，**放 key 的地方**）
 *   < 环境变量 DEEPSEEK_API_KEY / OPENAI_API_KEY / AI_BASE_URL / AI_MODEL
 */
export function loadAiConfig(root = process.cwd()) {
  const cfg = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: '', concurrency: 3 }
  const base = readJson(join(root, 'config.json'))
  if (base && base.ai) Object.assign(cfg, base.ai)
  const local = readJson(join(root, 'config.local.json'))
  if (local && local.ai) Object.assign(cfg, local.ai)
  cfg.apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || cfg.apiKey || ''
  cfg.baseUrl = process.env.AI_BASE_URL || cfg.baseUrl
  cfg.model = process.env.AI_MODEL || cfg.model
  cfg.concurrency = Math.max(1, Number(cfg.concurrency) || 3)
  return cfg
}

async function callOnce(cfg, prompt, signal) {
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    }),
    signal,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  const data = await res.json()
  return data?.choices?.[0]?.message?.content ?? ''
}

function abortError() {
  const err = new Error('已取消')
  err.name = 'AbortError'
  return err
}

/** 可被 abort 打断的等待（重试退避时取消要立刻生效）。 */
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function callWithRetry(cfg, prompt, tries = 3, signal) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    if (signal?.aborted) throw abortError()
    try {
      return await callOnce(cfg, prompt, signal)
    } catch (e) {
      if (signal?.aborted) throw abortError()
      lastErr = e
      await delay(800 * (i + 1), signal)
    }
  }
  throw lastErr
}

/**
 * 逐条跑完 jobs（并发 = cfg.concurrency）。
 * onProgress(done, total, result) 每完成一条回调一次；失败的 raw 为空串。
 *
 * `signal` abort 后：不再取新 job、不再发新请求，在途 fetch 会被取消；
 * 已完成的条目保留在结果数组里（调用方自己决定怎么展示）。
 */
export async function runJobs(jobs, cfg, { onProgress, signal } = {}) {
  const results = new Array(jobs.length)
  let cursor = 0
  let done = 0
  const worker = async () => {
    while (cursor < jobs.length) {
      if (signal?.aborted) return
      const i = cursor++
      const job = jobs[i]
      let raw = ''
      let error = ''
      try {
        raw = await callWithRetry(cfg, job.prompt, 3, signal)
      } catch (e) {
        if (signal?.aborted) return
        error = String((e && e.message) || e)
      }
      if (signal?.aborted) return
      const entry = { id: job.id, task: job.task, raw, error }
      results[i] = entry
      done++
      if (onProgress) onProgress(done, jobs.length, entry)
    }
  }
  await Promise.all(Array.from({ length: cfg.concurrency }, worker))
  return results
}

// ---------- HTTP 接口（生产 httpApp.js 与 dev vite 插件共用） ----------

const runs = new Map()
/** 客户端先发取消、启动请求后到（网络乱序）时，用这个墓碑把新 run 直接判取消。 */
const cancelledRuns = new Map()
const RUN_TTL = 30 * 60 * 1000
const MAX_CANCELLED_IDS = 500

/** 客户端生成的 runId 只允许安全字符，避免被拿来拼 key / 注入。 */
function isRunId(value) {
  return typeof value === 'string' && /^run-[A-Za-z0-9_-]{4,64}$/.test(value)
}

function newRunId() {
  return 'run-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function sendJson(res, code, obj) {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(obj))
}

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > limit) req.destroy()
    })
    req.on('end', () => resolve(body))
    req.on('error', () => resolve(''))
  })
}

function gcRuns() {
  const now = Date.now()
  for (const [id, r] of runs) {
    if (now - r.startedAt > RUN_TTL) {
      r.controller?.abort()
      runs.delete(id)
    }
  }
  for (const [id, at] of cancelledRuns) {
    if (now - at > RUN_TTL) cancelledRuns.delete(id)
  }
  // 防止有人刷取消接口把内存撑大
  while (cancelledRuns.size > MAX_CANCELLED_IDS) {
    const oldest = cancelledRuns.keys().next().value
    if (oldest === undefined) break
    cancelledRuns.delete(oldest)
  }
}

/**
 * 处理 `/api/ai/*`：
 *   GET  /api/ai/status      → { configured, model }（**绝不回传 key**）
 *   POST /api/ai/run  { jobs } → { runId, total }（后台开跑）
 *   GET  /api/ai/run?id=     → { state, done, total, results, error }
 *   POST /api/ai/cancel { runId } → { runId, state, done, total }（真正停掉服务端跑批）
 */
export function handleAiApi(req, res, { root = process.cwd() } = {}) {
  const [path, query] = (req.url || '').split('?')
  const cfg = loadAiConfig(root)

  if (path === '/api/ai/status') {
    sendJson(res, 200, { configured: !!cfg.apiKey, model: cfg.apiKey ? cfg.model : '' })
    return
  }

  if (path === '/api/ai/run' && req.method === 'POST') {
    if (!cfg.apiKey) {
      sendJson(res, 400, {
        error: 'no-key',
        message: '未配置 API key：把 key 填进 config.local.json 的 ai.apiKey（该文件已 gitignore）',
      })
      return
    }
    gcRuns()
    // 先占位再读 body：客户端在启动请求还没回来时点取消，也能按 runId 找到它。
    // runId 由客户端生成（query 传），服务端只在缺失/非法时补一个。
    const requested = new URLSearchParams(query || '').get('runId') || ''
    const runId = isRunId(requested) && !runs.has(requested) ? requested : newRunId()
    const controller = new AbortController()
    const run = {
      state: 'running',
      done: 0,
      total: 0,
      results: [],
      failed: [],
      startedAt: Date.now(),
      error: '',
      controller,
    }
    runs.set(runId, run)
    // 取消请求先到：启动时直接判取消，别等 body 读完再开跑。
    if (cancelledRuns.has(runId)) {
      cancelledRuns.delete(runId)
      run.state = 'cancelled'
      run.error = '已取消'
      controller.abort()
    }
    readBody(req).then((body) => {
      let jobs
      try {
        jobs = JSON.parse(body).jobs
      } catch {
        jobs = null
      }
      if (!Array.isArray(jobs) || !jobs.length) {
        run.state = 'error'
        run.error = 'bad-jobs'
        sendJson(res, 400, { error: 'bad-jobs', message: '缺少 jobs 数组' })
        return
      }
      run.total = jobs.length
      if (run.state === 'cancelled') {
        sendJson(res, 200, { runId, state: 'cancelled', total: jobs.length })
        return
      }
      runJobs(jobs, cfg, {
        signal: controller.signal,
        onProgress: (done, total, last) => {
          run.done = done
          run.total = total
          if (last && last.raw && last.raw.trim()) run.results.push(last)
          else if (last) run.failed.push({ id: last.id, error: last.error || '空回复' })
        },
      })
        .then((all) => {
          if (run.state === 'cancelled') {
            // 取消时保留已完成的部分，别把 results 清空
            run.results = all.filter((r) => r && r.raw && r.raw.trim())
            run.failed = all
              .filter((r) => r && !(r.raw && r.raw.trim()))
              .map((r) => ({ id: r.id, error: r.error || '空回复' }))
            return
          }
          run.results = all.filter((r) => r && r.raw && r.raw.trim())
          run.failed = all
            .filter((r) => r && !(r.raw && r.raw.trim()))
            .map((r) => ({ id: r.id, error: r.error || '空回复' }))
          run.done = all.length
          run.state = 'done'
        })
        .catch((e) => {
          if (run.state === 'cancelled') return
          run.state = 'error'
          run.error = String((e && e.message) || e)
        })
      sendJson(res, 200, { runId, total: jobs.length })
    })
    return
  }

  if (path === '/api/ai/cancel' && req.method === 'POST') {
    readBody(req).then((body) => {
      let runId = new URLSearchParams(query || '').get('id') || ''
      try {
        if (!runId) runId = String(JSON.parse(body).runId || '')
      } catch {
        // body 不是 JSON：继续用 query
      }
      const run = runs.get(runId)
      if (!run) {
        // 取消可能比启动请求先到（网络乱序）：留个墓碑，启动时直接判取消。
        if (isRunId(runId)) {
          gcRuns()
          cancelledRuns.set(runId, Date.now())
        }
        sendJson(res, 404, { error: 'no-run' })
        return
      }
      if (run.state === 'running') {
        run.state = 'cancelled'
        run.error = '已取消'
        run.controller?.abort()
      }
      sendJson(res, 200, { runId, state: run.state, done: run.done, total: run.total })
    })
    return
  }

  if (path === '/api/ai/run' && req.method === 'GET') {
    const id = new URLSearchParams(query || '').get('id') || ''
    const run = runs.get(id)
    if (!run) {
      sendJson(res, 404, { error: 'no-run' })
      return
    }
    sendJson(res, 200, {
      state: run.state,
      done: run.done,
      total: run.total,
      results: run.results,
      failed: run.failed,
      error: run.error,
    })
    return
  }

  sendJson(res, 404, { error: 'not-found' })
}
