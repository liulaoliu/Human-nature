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
import {
  LOCAL_PREFIX,
  PIPER_VOICES,
  SAPI_PREFIX,
  listLocalVoices,
  listSapiVoices,
  piperStatus,
  synthPiper,
  synthSapi,
} from './tts-local.mjs'

/**
 * TTS 共享核心（dev 走 Vite 插件，static 走 httpApp.js）。三个引擎：
 *
 *   edge（默认，在线）  GET /api/tts?voice=en-US-AriaNeural&text=Hello   → audio/mpeg
 *   sapi（离线，系统）  GET /api/tts?voice=sapi:Microsoft%20Zira%20Desktop&text=Hello → audio/wav
 *   local（离线，Linux）GET /api/tts?voice=local:piper-us-lessac&text=Hello → audio/wav
 *   GET /api/tts/words?voice=…&text=…    → 逐词时间戳 JSON（仅 edge；离线引擎为 []）
 *   GET /api/tts/engines                 → { edge, sapi, local: { available, voices } }
 *
 * Edge 连续失败时自动降级到本机 Piper（神经音色）；本机也没有时由前端退回浏览器语音。
 * Piper 降级 60 秒、Edge 降级 20 秒后都会回头重试。
 * 缓存：public/tts/<sha1(engine+voice+text)>.<mp3|wav>（edge 另存同名 .json 逐词时间戳）。
 * 只服务本机自用：文本长度上限、并发上限、硬超时、失败重试、缓存条数上限。
 */

export const DEFAULT_VOICE = 'en-US-AriaNeural'

const EDGE_VOICE_RE = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9]+Neural$/
const MAX_TEXT = 600
const MAX_CONCURRENT = 2
const SYNTH_TIMEOUT_MS = 20000
const RETRIES = 1
const MAX_CACHE_FILES = 800
/** Edge 失败后先走本地引擎多久，再回头重试 Edge。 */
const EDGE_RETRY_MS = 20000
/** Piper 失败后先降级多久，再回头重试 Piper。 */
const PIPER_RETRY_MS = 60000


const LOCAL_VOICE_MAP = new Map(
  PIPER_VOICES.map((v) => [v.id, { ...v, kind: 'piper' }]),
)
/** 当前是否处于「Edge 降级期」；0 = 正常。 */
let edgeDownUntil = 0
/** 当前是否处于「Piper 降级期」；0 = 正常。 */
let piperDownUntil = 0

/** 正在合成的任务（同一 key 不重复合成）。 */
const inflight = new Map()

// ---- 并发闸门 ----
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

/** 从 voice 参数解析出引擎 / 音色 / 缓存扩展名。 */
export function parseTarget(rawIn) {
  const raw = (rawIn || '').trim()
  if (raw.startsWith(SAPI_PREFIX)) {
    const name = raw.slice(SAPI_PREFIX.length).trim()
    if (name) return { engine: 'sapi', voice: name, ext: 'wav' }
  }
  if (raw.startsWith(LOCAL_PREFIX)) {
    // 只认白名单音色；拼错的 local:xxx 不要静默拿去跑命令行。
    if (LOCAL_VOICE_MAP.has(raw)) return { engine: 'local', voice: raw, ext: 'wav' }
  }
  if (EDGE_VOICE_RE.test(raw)) return { engine: 'edge', voice: raw, ext: 'mp3' }
  return { engine: 'edge', voice: DEFAULT_VOICE, ext: 'mp3' }
}

// ---- Edge（在线） ----
/** Node 不会自动读系统代理；Edge TTS 走不通时优先显式用环境里的 HTTP(S) 代理。 */
export function edgeProxyFromEnv(env = process.env) {
  return env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || ''
}

async function synthEdge(text, voice, outPath) {
  const mod = await import('node-edge-tts')
  const lang = voice.split('-').slice(0, 2).join('-')
  const proxy = edgeProxyFromEnv()
  const tts = new mod.EdgeTTS({
    voice,
    lang,
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    saveSubtitles: true, // 逐词时间戳写到 `<outPath>.json`
    timeout: SYNTH_TIMEOUT_MS,
    ...(proxy ? { proxy } : {}),
  })
  await tts.ttsPromise(text, outPath)
}



/** Edge 音色 → 本地口音（美式/英式）。 */
export function edgeLangFor(voice) {
  return /^en-(US|CA)/i.test(voice) ? 'en-US' : 'en-GB'
}

const EDGE_FEMALE_NAMES = new Set([
  'Aria',
  'Jenny',
  'Michelle',
  'Ava',
  'Emma',
  'Ana',
  'Sonia',
  'Libby',
  'Maisie',
  'Natasha',
  'Clara',
  'Emily',
  'Neerja',
  'Molly',
  'Leah',
  'Luna',
  'Yan',
  'Rosa',
])

/** 从 Edge 音色名猜性别，本地兜底时尽量不换性别。 */
function edgeGenderFor(voice) {
  const name = (voice.split('-')[2] || '').replace(/Neural$/, '')
  return EDGE_FEMALE_NAMES.has(name) ? 'Female' : 'Male'
}

/** 优先同口音 + 同性别，其次同口音，最后任意。 */
export function pickVoiceFor(voices, lang, gender) {
  return (
    voices.find((v) => v.lang === lang && v.gender === gender) ||
    voices.find((v) => v.lang === lang) ||
    voices[0] ||
    null
  )
}

/**
 * Edge 失败时挑一个同口音/同性别的 Piper 音色；没装 Piper 就交给浏览器语音。
 * 导出只为测试（这里曾经把 `listLocalVoices` 写成没导入的 `listPiperVoices`，
 * 一句 TTS 请求直接 502，见 tts-core.test.mjs）。
 */
export function localFallbackTargets(edgeVoice) {
  const piper = pickVoiceFor(listLocalVoices(), edgeLangFor(edgeVoice), edgeGenderFor(edgeVoice))
  return piper ? [{ engine: 'local', voice: piper.id, ext: 'wav' }] : []
}

function targetConfig(target) {
  return target.engine === 'local' ? LOCAL_VOICE_MAP.get(target.voice) || null : null
}

/** 手动选了 Piper 但失败时不再换另一个引擎，直接让前端退回浏览器语音。 */
function fallbackTargets(target) {
  return target.engine === 'edge' ? localFallbackTargets(target.voice) : []
}

function targetDownUntil(target) {
  if (target.engine === 'edge') return edgeDownUntil
  const v = targetConfig(target)
  return v?.kind === 'piper' ? piperDownUntil : 0
}

function fallbackFileFor(target, file) {
  if (target.engine === 'edge') return `${file}.local.wav`
  const v = targetConfig(target)
  return v?.kind === 'piper' ? `${file}.fallback.wav` : null
}


// ---- 通用合成到文件 ----
async function synthOnce(text, target, outPath, wordsPath) {
  if (target.engine === 'sapi') return synthSapi(text, target.voice, outPath, wordsPath)
  if (target.engine === 'local') {
    const v = targetConfig(target)
    if (v?.kind === 'piper') return synthPiper(text, v.model, outPath)
    throw new Error(`unknown local voice: ${target.voice}`)
  }
  return synthEdge(text, target.voice, outPath)
}

async function synthToFile(text, target, file) {
  const tmp = `${file}.part`
  const tmpJson = `${tmp}.json`
  let lastErr
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      await withTimeout(synthOnce(text, target, tmp, tmpJson), SYNTH_TIMEOUT_MS + 3000, 'tts')
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

function pruneCache(dir) {
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith('.mp3') || f.endsWith('.wav'))
    if (files.length <= MAX_CACHE_FILES) return
    const rows = files
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

function fileReady(p) {
  try {
    return existsSync(p) && statSync(p).size > 0
  } catch {
    return false
  }
}

/** 当前可服务的文件：主文件，或降级期内已生成的本地兜底文件。 */
function pickAudio(target, file) {
  if (fileReady(file)) return { file, ext: target.ext }
  const fb = fallbackFileFor(target, file)
  if (fb && Date.now() < targetDownUntil(target) && fileReady(fb)) {
    return { file: fb, ext: 'wav' }
  }
  return null
}

/**
 * 按兜底链逐级合成：Edge → Piper；手动选 Piper 时只试 Piper。
 * 失败一次就把对应引擎打入临时降级期，后续请求直接走下一级，避免每句都等超时。
 * Piper 也没有/失败时由前端退回浏览器语音。
 */
async function synthWithFallbacks(text, target, file) {
  const fallbackFile = fallbackFileFor(target, file)
  let lastErr
  // 兜底候选**等主目标真的失败之后**才去解析。
  //
  // 之前写的是 `for (const attempt of [target, ...fallbackTargets(target)])` —— 数组在循环前
  // 就展开了，于是兜底代码里一个笔误（`listPiperVoices` 根本没导入）会在**尝试 Edge 之前**
  // 就抛 ReferenceError，把所有请求统一打成 502 "tts failed: listPiperVoices is not defined"，
  // 而主路径（Edge）当时明明是好的。降级链再烂，也不该把主路径一起带崩。
  const queue = [target]
  for (let i = 0; i < queue.length; i++) {
    const attempt = queue[i]
    if (Date.now() < targetDownUntil(attempt)) continue
    const outPath = attempt === target ? file : fallbackFile
    if (!outPath) continue
    try {
      await synthToFile(text, attempt, outPath)
      return
    } catch (e) {
      lastErr = e
      if (attempt.engine === 'edge') edgeDownUntil = Date.now() + EDGE_RETRY_MS
      if (targetConfig(attempt)?.kind === 'piper') piperDownUntil = Date.now() + PIPER_RETRY_MS
      if (i === 0) {
        try {
          queue.push(...fallbackTargets(target))
        } catch (fe) {
          // 兜底解析坏了只丢兜底，报出来但别影响主路径的失败原因
          console.warn(`[tts] 兜底候选解析失败，本次只用主引擎：${fe && fe.message ? fe.message : fe}`)
        }
      }
    }
  }
  throw lastErr || new Error('tts failed')
}

/**
 * 确保音频已缓存，返回实际要服务的文件（在线 mp3 / 本地 wav）。
 * 自动兜底：Edge → Piper；降级期结束后回头重试上级引擎。
 */
async function ensureAudio(text, target, file, cacheDir) {
  const hit = pickAudio(target, file)
  if (hit) return hit

  let job = inflight.get(file)
  if (!job) {
    job = withSlot(async () => {
      if (pickAudio(target, file)) return
      await synthWithFallbacks(text, target, file)
      pruneCache(cacheDir)
    })
    inflight.set(file, job)
    try {
      await job
    } finally {
      inflight.delete(file)
    }
  } else {
    await job
  }

  const out = pickAudio(target, file)
  if (out) return out
  throw new Error('tts produced no audio')
}

function bad(res, code, msg) {
  res.statusCode = code
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.end(msg)
  return true
}

async function handleEngines(res) {
  const sapi = await listSapiVoices()
  const local = listLocalVoices()
  // reason：本机离线引擎为什么没出现（no-binary / no-voices-dir / no-models / ok）。
  // 前端目前只按 voices 决定要不要显示那一组，reason 是给排障和日志看的事实。
  const reason = piperStatus()
  if (reason !== 'ok') {
    console.info(`[tts] 离线本地语音不可用：${reason}（详见 docs/TESTING.md §4「离线 TTS（Piper）」）`)
  }
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(
    JSON.stringify({
      edge: true,
      sapi: { available: sapi.length > 0, voices: sapi },
      local: { available: local.length > 0, voices: local, reason },
    }),
  )
  return true
}

/**
 * 处理 /api/tts* 。返回 true 表示已接管（无论成功失败）。
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ cacheDir: string }} opts
 */
export async function handleTts(req, res, { cacheDir }) {
  let url
  try {
    url = new URL(req.url || '/', 'http://localhost')
  } catch {
    return bad(res, 400, 'bad url')
  }
  const { pathname } = url

  if (pathname === '/api/tts/engines') return handleEngines(res)
  if (pathname !== '/api/tts' && pathname !== '/api/tts/words') return false

  const text = (url.searchParams.get('text') || '').trim()
  const target = parseTarget(url.searchParams.get('voice'))
  if (!text) return bad(res, 400, 'missing text')
  if (text.length > MAX_TEXT) return bad(res, 413, 'text too long')

  const key = createHash('sha1').update(`${target.engine}\n${target.voice}\n${text}`).digest('hex')
  const file = join(cacheDir, `${key}.${target.ext}`)

  // 只查缓存、不合成（增量预生成用来找「缺哪几句」）
  if (url.searchParams.get('check') === '1') {
    // 降级期内，上次生成的本地兜底也算「这句有音频」，避免反复预生成；
    // 上级引擎恢复后则只认主缓存，让预生成补回更高质量音频。
    const cached = Boolean(pickAudio(target, file))
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ cached }))
    return true
  }

  try {
    mkdirSync(cacheDir, { recursive: true })
    const out = await ensureAudio(text, target, file, cacheDir)

    if (pathname === '/api/tts/words') {
      const jf = `${out.file}.json`
      if (existsSync(jf)) {
        const st = statSync(jf)
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Content-Length', st.size)
        if (req.method === 'HEAD') return res.end(), true
        createReadStream(jf).pipe(res)
      } else {
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end('[]')
      }
      return true
    }

    const st = statSync(out.file)
    res.statusCode = 200
    res.setHeader('Content-Type', out.ext === 'wav' ? 'audio/wav' : 'audio/mpeg')
    res.setHeader('Content-Length', st.size)
    res.setHeader('Cache-Control', 'public, max-age=604800')
    if (req.method === 'HEAD') {
      res.end()
      return true
    }
    createReadStream(out.file).pipe(res)
  } catch (e) {
    return bad(res, 502, `tts failed: ${e && e.message ? e.message : e}`)
  }
  return true
}
