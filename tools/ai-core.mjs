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

async function callOnce(cfg, prompt) {
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
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  const data = await res.json()
  return data?.choices?.[0]?.message?.content ?? ''
}

async function callWithRetry(cfg, prompt, tries = 3) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try {
      return await callOnce(cfg, prompt)
    } catch (e) {
      lastErr = e
      await new Promise((r) => setTimeout(r, 800 * (i + 1)))
    }
  }
  throw lastErr
}

/**
 * 逐条跑完 jobs（并发 = cfg.concurrency）。
 * onProgress(done, total, result) 每完成一条回调一次；失败的 raw 为空串。
 */
export async function runJobs(jobs, cfg, { onProgress } = {}) {
  const results = new Array(jobs.length)
  let cursor = 0
  let done = 0
  const worker = async () => {
    while (cursor < jobs.length) {
      const i = cursor++
      const job = jobs[i]
      let raw = ''
      let error = ''
      try {
        raw = await callWithRetry(cfg, job.prompt)
      } catch (e) {
        error = String((e && e.message) || e)
      }
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
const RUN_TTL = 30 * 60 * 1000

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
  for (const [id, r] of runs) if (now - r.startedAt > RUN_TTL) runs.delete(id)
}

/**
 * 处理 `/api/ai/*`：
 *   GET  /api/ai/status      → { configured, model }（**绝不回传 key**）
 *   POST /api/ai/run  { jobs } → { runId, total }（后台开跑）
 *   GET  /api/ai/run?id=     → { state, done, total, results, error }
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
    readBody(req).then((body) => {
      let jobs
      try {
        jobs = JSON.parse(body).jobs
      } catch {
        jobs = null
      }
      if (!Array.isArray(jobs) || !jobs.length) {
        sendJson(res, 400, { error: 'bad-jobs', message: '缺少 jobs 数组' })
        return
      }
      gcRuns()
      const runId = 'run-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      const run = { state: 'running', done: 0, total: jobs.length, results: [], failed: [], startedAt: Date.now(), error: '' }
      runs.set(runId, run)
      runJobs(jobs, cfg, {
        onProgress: (done, total, last) => {
          run.done = done
          run.total = total
          if (last && last.raw && last.raw.trim()) run.results.push(last)
          else if (last) run.failed.push({ id: last.id, error: last.error || '空回复' })
        },
      })
        .then((all) => {
          run.results = all.filter((r) => r.raw && r.raw.trim())
          run.failed = all
            .filter((r) => !(r.raw && r.raw.trim()))
            .map((r) => ({ id: r.id, error: r.error || '空回复' }))
          run.done = all.length
          run.state = 'done'
        })
        .catch((e) => {
          run.state = 'error'
          run.error = String((e && e.message) || e)
        })
      sendJson(res, 200, { runId, total: jobs.length })
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
