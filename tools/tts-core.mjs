import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * TTS 共享核心（dev 走 Vite 插件，static 走 httpApp.js）。三个引擎：
 *
 *   edge（默认，在线）  GET /api/tts?voice=en-US-AriaNeural&text=Hello   → audio/mpeg
 *   sapi（离线，系统）  GET /api/tts?voice=sapi:Microsoft%20Zira%20Desktop&text=Hello → audio/wav
 *   local（离线，Linux）GET /api/tts?voice=local:piper-us-lessac&text=Hello → audio/wav
 *   GET /api/tts/words?voice=…&text=…    → 逐词时间戳 JSON（仅 edge；离线引擎为 []）
 *   GET /api/tts/engines                 → { edge, sapi, local: { available, voices } }
 *
 * Edge 连续失败时自动降级到本机 Piper（神经音色），再失败用 espeak-ng 应急；
 * 本机也没有时由前端退回浏览器语音。Piper 降级 60 秒、Edge 降级 20 秒后都会回头重试。
 * 缓存：public/tts/<sha1(engine+voice+text)>.<mp3|wav>（edge 另存同名 .json 逐词时间戳）。
 * 只服务本机自用：文本长度上限、并发上限、硬超时、失败重试、缓存条数上限。
 */

export const DEFAULT_VOICE = 'en-US-AriaNeural'

const EDGE_VOICE_RE = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9]+Neural$/
const SAPI_PREFIX = 'sapi:'
const LOCAL_PREFIX = 'local:'
const MAX_TEXT = 600
const MAX_CONCURRENT = 2
const SYNTH_TIMEOUT_MS = 20000
const RETRIES = 1
const MAX_CACHE_FILES = 800
/** Edge 失败后先走本地引擎多久，再回头重试 Edge。 */
const EDGE_RETRY_MS = 20000
/** Piper 失败后先用 espeak 顶多久，再回头重试 Piper。 */
const PIPER_RETRY_MS = 60000

/**
 * espeak-ng 应急音色：音质机器人，但只依赖 apt，Piper 不可用/失败时兜底。
 * 固定白名单，避免把任意字符串拼进命令行。
 */
const ESPEAK_VOICES = [
  { id: 'local:en-us', name: 'Espeak 应急 美音（男）', voice: 'en-us', gender: 'Male', lang: 'en-US' },
  { id: 'local:en-us+f3', name: 'Espeak 应急 美音（女）', voice: 'en-us+f3', gender: 'Female', lang: 'en-US' },
  { id: 'local:en-gb', name: 'Espeak 应急 英音（男）', voice: 'en-gb', gender: 'Male', lang: 'en-GB' },
  {
    id: 'local:en-gb-x-rp',
    name: 'Espeak 应急 英音 RP（男）',
    voice: 'en-gb-x-rp',
    gender: 'Male',
    lang: 'en-GB',
  },
  {
    id: 'local:en-gb-x-rp+f3',
    name: 'Espeak 应急 英音 RP（女）',
    voice: 'en-gb-x-rp+f3',
    gender: 'Female',
    lang: 'en-GB',
  },
]

/** Piper 离线神经音色；只有模型文件存在时才出现在下拉里。 */
const PIPER_VOICES = [
  {
    id: 'local:piper-us-lessac',
    name: 'Piper 美音 Lessac',
    model: 'en_US-lessac-medium',
    gender: 'Female',
    lang: 'en-US',
  },
  {
    id: 'local:piper-us-ryan',
    name: 'Piper 美音 Ryan（高清）',
    model: 'en_US-ryan-high',
    gender: 'Male',
    lang: 'en-US',
  },
  {
    id: 'local:piper-gb-cori',
    name: 'Piper 英音 Cori（高清）',
    model: 'en_GB-cori-high',
    gender: 'Female',
    lang: 'en-GB',
  },
  {
    id: 'local:piper-gb-northern',
    name: 'Piper 英音 Northern',
    model: 'en_GB-northern_english_male-medium',
    gender: 'Male',
    lang: 'en-GB',
  },
]

const LOCAL_VOICE_MAP = new Map([
  ...PIPER_VOICES.map((v) => [v.id, { ...v, kind: 'piper' }]),
  ...ESPEAK_VOICES.map((v) => [v.id, { ...v, kind: 'espeak' }]),
])
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

// ---- SAPI（离线，Windows 系统语音） ----
const SAPI_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
if ($env:TTS_VOICE) { try { $s.SelectVoice($env:TTS_VOICE) } catch {} }
$s.SetOutputToWaveFile($env:TTS_OUT)
$list = New-Object System.Collections.ArrayList
$sb = { param($sender, $e) [void]$list.Add([pscustomobject]@{ t = $e.Text; ms = [int]$e.AudioPosition.TotalMilliseconds }) }
$s.add_SpeakProgress($sb)
$txt = [Console]::In.ReadToEnd()
$s.Speak($txt)
$s.remove_SpeakProgress($sb)
$s.Dispose()
if ($env:TTS_WORDS) {
  $totalMs = 0
  try {
    $b = [System.IO.File]::ReadAllBytes($env:TTS_OUT)
    if ($b.Length -gt 44) {
      $br = [BitConverter]::ToInt32($b, 28)
      $ds = [BitConverter]::ToInt32($b, 40)
      if ($br -gt 0) { $totalMs = [int](($ds / $br) * 1000) }
    }
  } catch {}
  $parts = @()
  for ($i = 0; $i -lt $list.Count; $i++) {
    $start = $list[$i].ms
    if ($i + 1 -lt $list.Count) { $end = $list[$i + 1].ms }
    elseif ($totalMs -gt $start) { $end = $totalMs }
    else { $end = $start + 300 }
    $parts += [pscustomobject]@{ part = $list[$i].t; start = $start; end = $end }
  }
  [System.IO.File]::WriteAllText($env:TTS_WORDS, (ConvertTo-Json -InputObject $parts -Compress))
}
`.trim()

function synthSapi(text, voiceName, outWav, outWords) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new Error('sapi only on Windows'))
      return
    }
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SAPI_SCRIPT], {
      env: { ...process.env, TTS_VOICE: voiceName, TTS_OUT: outWav, TTS_WORDS: outWords || '' },
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    let err = ''
    ps.stderr.on('data', (d) => {
      err += String(d)
    })
    ps.on('error', reject)
    ps.on('close', (code) => {
      try {
        if (code === 0 && existsSync(outWav) && statSync(outWav).size > 44) resolve()
        else reject(new Error(`sapi exit ${code}: ${err.slice(0, 200)}`))
      } catch (e) {
        reject(e)
      }
    })
    ps.stdin.write(text)
    ps.stdin.end()
  })
}

let sapiCache = null
function listSapiVoices() {
  if (sapiCache) return Promise.resolve(sapiCache)
  if (process.platform !== 'win32') {
    sapiCache = []
    return Promise.resolve([])
  }
  return new Promise((resolve) => {
    const script =
      'Add-Type -AssemblyName System.Speech; ' +
      '(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ' +
      'ForEach-Object { $i=$_.VoiceInfo; "$($i.Name)`t$($i.Gender)`t$($i.Culture)" }'
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let out = ''
    ps.stdout.on('data', (d) => {
      out += String(d)
    })
    ps.on('error', () => {
      sapiCache = []
      resolve([])
    })
    ps.on('close', () => {
      const voices = out
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [name, gender, lang] = l.split('\t')
          return { id: `${SAPI_PREFIX}${name}`, name, gender: gender || '', lang: lang || '' }
        })
      sapiCache = voices
      resolve(voices)
    })
  })
}

// ---- local（离线，Piper 优先 / espeak-ng 应急） ----
let espeakBin
/** 找 espeak-ng（老系统可能只有 espeak）；结果缓存。 */
function findEspeak() {
  if (espeakBin !== undefined) return espeakBin
  for (const bin of ['espeak-ng', 'espeak']) {
    try {
      const r = spawnSync(bin, ['--version'], { stdio: 'ignore', timeout: 2000 })
      if (r.status === 0) {
        espeakBin = bin
        return bin
      }
    } catch {
      // 试下一个
    }
  }
  espeakBin = null
  return null
}

let espeakCache = null
function listEspeakVoices() {
  if (espeakCache) return espeakCache
  if (!findEspeak()) {
    espeakCache = []
    return espeakCache
  }
  espeakCache = ESPEAK_VOICES.map(({ id, name, gender, lang }) => ({ id, name, gender, lang }))
  return espeakCache
}

let piperBin
/** 找 Piper：环境变量 → PATH → 本机安装目录。 */
function findPiper() {
  if (piperBin !== undefined) return piperBin
  const candidates = [
    process.env.PIPER_BIN,
    'piper',
    join(homedir(), '.local/opt/piper/piper'),
    '/opt/piper/piper',
    '/usr/local/bin/piper',
    '/usr/bin/piper',
  ].filter(Boolean)
  for (const bin of candidates) {
    try {
      const r = spawnSync(bin, ['--help'], { stdio: 'ignore', timeout: 2000 })
      if (r.status === 0) {
        piperBin = bin
        return bin
      }
    } catch {
      // 试下一个
    }
  }
  piperBin = null
  return null
}

/** Piper 模型目录：环境变量 → 二进制同级的 voices → 常见共享目录。 */
function piperVoicesDir() {
  const bin = findPiper()
  const binDir = bin && bin.includes('/') ? dirname(bin) : ''
  const candidates = [
    process.env.PIPER_VOICES_DIR,
    binDir ? join(binDir, 'voices') : '',
    join(homedir(), '.local/share/piper-voices'),
    '/usr/local/share/piper-voices',
    '/usr/share/piper-voices',
    '/opt/piper/voices',
  ].filter(Boolean)
  for (const d of candidates) {
    if (existsSync(d)) return d
  }
  return ''
}

function piperModelPath(model) {
  const dir = piperVoicesDir()
  if (!dir) return null
  const path = join(dir, `${model}.onnx`)
  return existsSync(path) && existsSync(`${path}.json`) ? path : null
}

let piperCache = null
/** 已安装模型的 Piper 音色；模型不存在就不显示。 */
function listPiperVoices() {
  if (piperCache) return piperCache
  if (!findPiper()) {
    piperCache = []
    return piperCache
  }
  piperCache = PIPER_VOICES.filter((v) => piperModelPath(v.model)).map(
    ({ id, name, gender, lang }) => ({ id, name, gender, lang }),
  )
  return piperCache
}

/** 顶栏下拉的离线音色：Piper 在前，espeak 应急在后。 */
function listLocalVoices() {
  return [...listPiperVoices(), ...listEspeakVoices()]
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

/** Edge 失败时按 Piper → espeak 的顺序挑本地音色。 */
function localFallbackTargets(edgeVoice) {
  const lang = edgeLangFor(edgeVoice)
  const gender = edgeGenderFor(edgeVoice)
  const out = []
  const piper = pickVoiceFor(listPiperVoices(), lang, gender)
  if (piper) out.push({ engine: 'local', voice: piper.id, ext: 'wav' })
  const espeak = pickVoiceFor(listEspeakVoices(), lang, gender)
  if (espeak) out.push({ engine: 'local', voice: espeak.id, ext: 'wav' })
  return out
}

function targetConfig(target) {
  return target.engine === 'local' ? LOCAL_VOICE_MAP.get(target.voice) || null : null
}

/** 手动选了 Piper 但 Piper 失败时，用 espeak 顶。 */
function fallbackTargets(target) {
  if (target.engine === 'edge') return localFallbackTargets(target.voice)
  const v = targetConfig(target)
  if (!v || v.kind !== 'piper') return []
  const espeak = pickVoiceFor(listEspeakVoices(), v.lang, v.gender)
  return espeak ? [{ engine: 'local', voice: espeak.id, ext: 'wav' }] : []
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

function synthEspeak(text, voiceId, outWav) {
  return new Promise((resolve, reject) => {
    const bin = findEspeak()
    const v = LOCAL_VOICE_MAP.get(voiceId)
    if (!bin || !v || v.kind !== 'espeak') {
      reject(new Error('espeak-ng not installed'))
      return
    }
    // 文本以 - 开头会被 espeak 当成选项；补个空格即可（不影响读音）。
    const input = text.startsWith('-') ? ` ${text}` : text
    const ps = spawn(bin, ['-v', v.voice, '-s', '160', '-w', outWav, input], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let err = ''
    ps.stderr.on('data', (d) => {
      err += String(d)
    })
    ps.on('error', reject)
    ps.on('close', (code) => {
      try {
        if (code === 0 && existsSync(outWav) && statSync(outWav).size > 44) resolve()
        else reject(new Error(`espeak exit ${code}: ${err.slice(0, 200)}`))
      } catch (e) {
        reject(e)
      }
    })
  })
}

function synthPiper(text, model, outWav) {
  return new Promise((resolve, reject) => {
    const bin = findPiper()
    const modelPath = piperModelPath(model)
    if (!bin || !modelPath) {
      reject(new Error('piper not installed'))
      return
    }
    const ps = spawn(bin, ['--model', modelPath, '--output_file', outWav, '--quiet'], {
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    let err = ''
    ps.stderr.on('data', (d) => {
      err += String(d)
    })
    ps.on('error', reject)
    ps.on('close', (code) => {
      try {
        if (code === 0 && existsSync(outWav) && statSync(outWav).size > 44) resolve()
        else reject(new Error(`piper exit ${code}: ${err.slice(0, 200)}`))
      } catch (e) {
        reject(e)
      }
    })
    ps.stdin.write(text)
    ps.stdin.end()
  })
}

// ---- 通用合成到文件 ----
async function synthOnce(text, target, outPath, wordsPath) {
  if (target.engine === 'sapi') return synthSapi(text, target.voice, outPath, wordsPath)
  if (target.engine === 'local') {
    const v = targetConfig(target)
    if (v?.kind === 'piper') return synthPiper(text, v.model, outPath)
    if (v?.kind === 'espeak') return synthEspeak(text, target.voice, outPath)
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
 * 按兜底链逐级合成：Edge → Piper → espeak-ng；手动选 Piper 时则是 Piper → espeak-ng。
 * 失败一次就把对应引擎打入临时降级期，后续请求直接走下一级，避免每句都等超时。
 */
async function synthWithFallbacks(text, target, file) {
  const fallbackFile = fallbackFileFor(target, file)
  let lastErr
  for (const attempt of [target, ...fallbackTargets(target)]) {
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
    }
  }
  throw lastErr || new Error('tts failed')
}

/**
 * 确保音频已缓存，返回实际要服务的文件（在线 mp3 / 本地 wav）。
 * 自动兜底：Edge → Piper → espeak-ng；降级期结束后回头重试上级引擎。
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
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(
    JSON.stringify({
      edge: true,
      sapi: { available: sapi.length > 0, voices: sapi },
      local: { available: local.length > 0, voices: local },
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
