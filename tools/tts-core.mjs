import { createHash } from 'node:crypto'
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { join } from 'node:path'

/**
 * Edge TTS 共享核心（dev 走 Vite 插件，static 走 httpApp.js）。
 *
 *   GET /api/tts?voice=en-US-AriaNeural&text=Hello        → audio/mpeg
 *   GET /api/tts/words?voice=…&text=…                     → 逐词时间戳 JSON
 *
 * 缓存：public/tts/<sha1(voice+text)>.mp3（+ 同名 .json 逐词时间戳）。
 * 音色不同 → 不同文件（换口音不会覆盖旧的；靠缓存上限自动清理）。
 *
 * 只服务本机自用：音色形状校验、文本长度上限、并发上限、硬超时、失败重试、
 * 缓存条数上限。合成失败返回 502，前端会自动退回浏览器语音
 * （见 src/reader/hooks/useSpeaking.ts）。
 */

export const DEFAULT_VOICE = 'en-US-AriaNeural'

/** 允许的音色形状（如 en-US-AriaNeural）。前端目录 src/core/ttsVoices.ts 可自由增删。 */
const VOICE_RE = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9]+Neural$/
/** 单次最长字符数（一句话够用；防滥用）。 */
const MAX_TEXT = 600
/** 同时最多几个合成任务（避免一次开一堆 WebSocket 被限流）。 */
const MAX_CONCURRENT = 2
/** 单次合成硬超时（毫秒）。库内部超时不会关连接，靠这里兜底。 */
const SYNTH_TIMEOUT_MS = 20000
/** 失败重试次数。 */
const RETRIES = 1
/** 缓存最多保留多少个音频（超出按最旧清理，连同 .json）。 */
const MAX_CACHE_FILES = 800

/** 正在合成的任务（同一 key 不重复合成）。 */
const inflight = new Map()

/** 简易并发闸门。 */
let active = 0
const waiters = []
async function withSlot(fn) {
  if (active >= MAX_CONCURRENT) await new Promise((r) => waiters.push(r))
  active++
  try {
    return await fn()
  } finally {
    active--
    const next = waiters.shift()
    if (next) next()
  }
}

/** 给任意 Promise 套一个硬超时（解决「连接阶段卡死不返回」）。 */
function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function rmQuiet(p) {
  try {
    if (existsSync(p)) unlinkSync(p)
  } catch {
    // 忽略
  }
}

async function synthOnce(text, voice, outPath) {
  const mod = await import('node-edge-tts')
  const lang = voice.split('-').slice(0, 2).join('-')
  const tts = new mod.EdgeTTS({
    voice,
    lang,
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    // 打开后库会把逐词时间戳写到 `<outPath>.json`
    saveSubtitles: true,
    timeout: SYNTH_TIMEOUT_MS,
  })
  await tts.ttsPromise(text, outPath)
}

/** 合成到 .part，成功后改名（+ 逐词 json）。带硬超时与重试。 */
async function synthToFile(text, voice, file) {
  const tmp = `${file}.part`
  const tmpJson = `${tmp}.json`
  let lastErr
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      await withTimeout(synthOnce(text, voice, tmp), SYNTH_TIMEOUT_MS + 3000, 'tts')
      if (!existsSync(tmp) || statSync(tmp).size === 0) throw new Error('empty audio')
      renameSync(tmp, file)
      if (existsSync(tmpJson)) renameSync(tmpJson, `${file}.json`)
      return
    } catch (e) {
      lastErr = e
      rmQuiet(tmp)
      rmQuiet(tmpJson)
    }
  }
  throw lastErr || new Error('tts failed')
}

/** 缓存超出上限时，按修改时间清掉最旧的（连带 .json）。 */
function pruneCache(dir) {
  try {
    const mp3 = readdirSync(dir).filter((f) => f.endsWith('.mp3'))
    if (mp3.length <= MAX_CACHE_FILES) return
    const rows = mp3
      .map((f) => {
        try {
          return { f, t: statSync(join(dir, f)).mtimeMs }
        } catch {
          return null
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.t - b.t)
    for (const { f } of rows.slice(0, rows.length - MAX_CACHE_FILES)) {
      rmQuiet(join(dir, f))
      rmQuiet(join(dir, `${f}.json`))
    }
  } catch {
    // 忽略
  }
}

async function ensureAudio(text, voice, file, cacheDir) {
  if (existsSync(file) && statSync(file).size > 0) return
  const existing = inflight.get(file)
  if (existing) return existing
  const job = withSlot(async () => {
    // 排队等待期间可能已被别的请求生成好
    if (existsSync(file) && statSync(file).size > 0) return
    await synthToFile(text, voice, file)
    pruneCache(cacheDir)
  })
  inflight.set(file, job)
  try {
    await job
  } finally {
    inflight.delete(file)
  }
}

/** 解析 + 校验查询参数。 */
function parseQuery(req) {
  const url = new URL(req.url || '/', 'http://localhost')
  const text = (url.searchParams.get('text') || '').trim()
  const rawVoice = url.searchParams.get('voice') || DEFAULT_VOICE
  const voice = VOICE_RE.test(rawVoice) ? rawVoice : DEFAULT_VOICE
  return { pathname: url.pathname, text, voice }
}

function bad(res, code, msg) {
  res.statusCode = code
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.end(msg)
  return true
}

/**
 * 处理 /api/tts 与 /api/tts/words。返回 true 表示已接管（无论成功失败）。
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ cacheDir: string }} opts
 */
export async function handleTts(req, res, { cacheDir }) {
  let q
  try {
    q = parseQuery(req)
  } catch {
    return bad(res, 400, 'bad url')
  }
  if (q.pathname !== '/api/tts' && q.pathname !== '/api/tts/words') return false
  const { pathname, text, voice } = q

  if (!text) return bad(res, 400, 'missing text')
  if (text.length > MAX_TEXT) return bad(res, 413, 'text too long')

  const key = createHash('sha1').update(`${voice}\n${text}`).digest('hex')
  const file = join(cacheDir, `${key}.mp3`)

  try {
    mkdirSync(cacheDir, { recursive: true })
    await ensureAudio(text, voice, file, cacheDir)

    if (pathname === '/api/tts/words') {
      const jf = `${file}.json`
      if (existsSync(jf)) {
        const st = statSync(jf)
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Content-Length', st.size)
        res.setHeader('Cache-Control', 'public, max-age=604800')
        if (req.method === 'HEAD') return res.end(), true
        createReadStream(jf).pipe(res)
      } else {
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end('[]')
      }
      return true
    }

    const st = statSync(file)
    res.statusCode = 200
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Content-Length', st.size)
    res.setHeader('Cache-Control', 'public, max-age=604800')
    if (req.method === 'HEAD') {
      res.end()
      return true
    }
    createReadStream(file).pipe(res)
  } catch (e) {
    return bad(res, 502, `tts failed: ${e && e.message ? e.message : e}`)
  }
  return true
}
