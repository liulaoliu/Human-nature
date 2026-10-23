import { spawn, spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'

/**
 * TTS 的本机离线引擎：Windows 系统语音（SAPI）与 Piper。
 *
 * 从 `tts-core.mjs` 抽出来的原因：这两块都是「找到本机程序 → 起子进程 → 等它写出音频文件」，
 * 只在 win32 / 装了 Piper 的机器上有意义，跟 Edge 在线合成、缓存、降级策略是两套东西。
 * 这里只管调用本机引擎，不做缓存、不排队、不管降级。
 */

export const SAPI_PREFIX = 'sapi:'
export const LOCAL_PREFIX = 'local:'

/** Piper 离线神经音色；只有模型文件存在时才出现在下拉里。 */
export const PIPER_VOICES = [
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

export function synthSapi(text, voiceName, outWav, outWords) {
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
export function listSapiVoices() {
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

// ---- local（离线，Piper） ----
let piperBin
/** Piper 可执行文件名：Windows 是 piper.exe，其余是 piper。 */
function piperExe() {
  return process.platform === 'win32' ? 'piper.exe' : 'piper'
}

/**
 * 找 Piper：环境变量 → PATH → 本机安装目录。
 *
 * **必须跨平台**：早先这里只写了 `~/.local/opt/piper/piper` 这类 Unix 路径，
 * Windows 上就算装了 Piper 也永远找不到（连 piper.exe 都不在候选里），
 * 顶栏下拉里那组「离线 · 本地语音」直接消失，看起来像「引擎没接进来」。
 */
function findPiper() {
  if (piperBin !== undefined) return piperBin
  const exe = piperExe()
  const home = homedir()
  const localAppData = process.env.LOCALAPPDATA || ''
  const programFiles = process.env.ProgramFiles || process.env.PROGRAMFILES || ''
  const candidates = [
    process.env.PIPER_BIN,
    exe, // 走 PATH（spawnSync 会按 PATH 解析）
    join(home, '.local/opt/piper', exe), // Linux 解压目录
    join(home, 'piper', exe), // 通用：家目录解压（Windows 用户最容易放这儿）
    localAppData && join(localAppData, 'piper', exe),
    localAppData && join(localAppData, 'Programs', 'piper', exe),
    programFiles && join(programFiles, 'piper', exe),
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

/**
 * Piper 模型目录：环境变量 → 二进制同级 / 上一级的 voices → 常见共享目录。
 * 判绝对路径必须用 `path.isAbsolute`：原来写的是 `bin.includes('/')`，
 * Windows 的 `C:\...\piper.exe` 不含 `/`，会被当成「在 PATH 里」而跳过同级目录。
 */
function piperVoicesDir() {
  const bin = findPiper()
  const binDir = bin && isAbsolute(bin) ? dirname(bin) : ''
  const localAppData = process.env.LOCALAPPDATA || ''
  const candidates = [
    process.env.PIPER_VOICES_DIR,
    binDir ? join(binDir, 'voices') : '',
    binDir ? join(binDir, '..', 'voices') : '',
    join(homedir(), '.local/share/piper-voices'),
    localAppData ? join(localAppData, 'piper', 'voices') : '',
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

/** 顶栏下拉的离线音色：只有 Piper。 */
export function listLocalVoices() {
  return listPiperVoices()
}

/**
 * 本机离线引擎为什么不可用 —— 给 `/api/tts/engines` 与排障用。
 *
 * 之前这个信息完全不可见：`listLocalVoices()` 返回空数组，前端只是「不显示那一组」，
 * 看起来像功能没接上，实际是三条路之一断了（没装 / 没模型 / 目录没找到）。
 */
export function piperStatus() {
  if (!findPiper()) return 'no-binary'
  if (!piperVoicesDir()) return 'no-voices-dir'
  return listPiperVoices().length ? 'ok' : 'no-models'
}

/** 用 Piper 把文本合成到 wav（模型缺失时 reject，由上层降级处理）。 */
export function synthPiper(text, model, outWav) {
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
