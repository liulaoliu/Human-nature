import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Edge TTS 共享核心（dev 走 Vite 插件，static 走 httpApp.js）。
 *
 * GET /api/tts?voice=en-US-AriaNeural&text=Hello
 *   → audio/mpeg（首次合成后按 voice+text 哈希缓存到 public/tts/<hash>.mp3）
 *
 * 只服务本机自用：白名单音色、限制文本长度。合成失败返回 502，前端会自动
 * 退回浏览器语音（见 src/reader/hooks/useSpeaking.ts）。
 */

export const DEFAULT_VOICE = 'en-US-AriaNeural'

/** 允许的音色（防止被当成任意微软 TTS 代理）。 */
const VOICES = new Set([
  'en-US-AriaNeural',
  'en-US-JennyNeural',
  'en-US-GuyNeural',
  'en-US-EmmaMultilingualNeural',
  'en-US-AnaNeural',
  'en-GB-SoniaNeural',
  'en-GB-RyanNeural',
  'en-GB-LibbyNeural',
])

/** 单次最长字符数（一句话够用；防滥用）。 */
const MAX_TEXT = 600

/** 正在合成中的任务（同一 key 不重复合成）。 */
const inflight = new Map()

async function synthToTmp(text, voice, outPath) {
  const mod = await import('node-edge-tts')
  const lang = voice.split('-').slice(0, 2).join('-')
  const tts = new mod.EdgeTTS({
    voice,
    lang,
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    timeout: 20000,
  })
  await tts.ttsPromise(text, outPath)
}

async function ensureAudio(text, voice, file) {
  if (existsSync(file) && statSync(file).size > 0) return
  if (inflight.has(file)) return inflight.get(file)
  const job = (async () => {
    const tmp = `${file}.part`
    try {
      await synthToTmp(text, voice, tmp)
      renameSync(tmp, file)
    } catch (e) {
      try {
        if (existsSync(tmp)) unlinkSync(tmp)
      } catch {
        // 忽略
      }
      throw e
    }
  })()
  inflight.set(file, job)
  try {
    await job
  } finally {
    inflight.delete(file)
  }
}

/**
 * 处理 /api/tts 请求。返回 true 表示已接管（无论成功失败）。
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ cacheDir: string }} opts
 */
export async function handleTts(req, res, { cacheDir }) {
  let url
  try {
    url = new URL(req.url || '/', 'http://localhost')
  } catch {
    res.statusCode = 400
    res.end('bad url')
    return true
  }
  if (url.pathname !== '/api/tts') return false

  const text = (url.searchParams.get('text') || '').trim()
  const rawVoice = url.searchParams.get('voice') || DEFAULT_VOICE
  const voice = VOICES.has(rawVoice) ? rawVoice : DEFAULT_VOICE

  if (!text) {
    res.statusCode = 400
    res.end('missing text')
    return true
  }
  if (text.length > MAX_TEXT) {
    res.statusCode = 413
    res.end('text too long')
    return true
  }

  const key = createHash('sha1').update(`${voice}\n${text}`).digest('hex')
  const file = join(cacheDir, `${key}.mp3`)

  try {
    mkdirSync(cacheDir, { recursive: true })
    await ensureAudio(text, voice, file)
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
    res.statusCode = 502
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end(`tts failed: ${e && e.message ? e.message : e}`)
  }
  return true
}
