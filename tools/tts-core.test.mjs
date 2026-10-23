import { describe, expect, it } from 'vitest'
import { edgeLangFor, edgeProxyFromEnv, localFallbackTargets, parseTarget, pickVoiceFor } from './tts-core.mjs'
import { piperStatus } from './tts-local.mjs'

describe('parseTarget', () => {
  it('Edge 音色', () => {
    expect(parseTarget('en-US-AriaNeural')).toEqual({
      engine: 'edge',
      voice: 'en-US-AriaNeural',
      ext: 'mp3',
    })
  })

  it('SAPI 音色', () => {
    expect(parseTarget('sapi:Microsoft Zira Desktop')).toEqual({
      engine: 'sapi',
      voice: 'Microsoft Zira Desktop',
      ext: 'wav',
    })
  })

  it('本机离线音色只认 Piper 白名单', () => {
    expect(parseTarget('local:piper-us-lessac')).toEqual({
      engine: 'local',
      voice: 'local:piper-us-lessac',
      ext: 'wav',
    })
    // 已删除的旧本地音色 id 必须回落到 Edge，不能再悄悄拿去跑命令行。
    expect(parseTarget('local:en-gb-x-rp+f3')).toEqual({
      engine: 'edge',
      voice: 'en-US-AriaNeural',
      ext: 'mp3',
    })
  })

  it('非法 / 空 voice 回落默认 Edge', () => {
    const fallback = { engine: 'edge', voice: 'en-US-AriaNeural', ext: 'mp3' }
    expect(parseTarget('local:rm -rf /')).toEqual(fallback)
    expect(parseTarget('local:')).toEqual(fallback)
    expect(parseTarget('')).toEqual(fallback)
    expect(parseTarget(null)).toEqual(fallback)
  })
})

describe('edgeLangFor', () => {
  it('美式 / 加拿大用 en-US，其余英语口音用 en-GB', () => {
    expect(edgeLangFor('en-US-AriaNeural')).toBe('en-US')
    expect(edgeLangFor('en-CA-ClaraNeural')).toBe('en-US')
    expect(edgeLangFor('en-GB-SoniaNeural')).toBe('en-GB')
    expect(edgeLangFor('en-AU-NatashaNeural')).toBe('en-GB')
    expect(edgeLangFor('en-IN-NeerjaNeural')).toBe('en-GB')
  })
})

describe('pickVoiceFor', () => {
  const voices = [
    { id: 'us-f', lang: 'en-US', gender: 'Female' },
    { id: 'us-m', lang: 'en-US', gender: 'Male' },
    { id: 'gb-f', lang: 'en-GB', gender: 'Female' },
  ]

  it('优先同口音 + 同性别', () => {
    expect(pickVoiceFor(voices, 'en-US', 'Male')?.id).toBe('us-m')
    expect(pickVoiceFor(voices, 'en-US', 'Female')?.id).toBe('us-f')
    expect(pickVoiceFor(voices, 'en-GB', 'Female')?.id).toBe('gb-f')
  })

  it('没有同性别时退到同口音，再退到任意', () => {
    expect(pickVoiceFor(voices, 'en-GB', 'Male')?.id).toBe('gb-f')
    expect(pickVoiceFor(voices, 'en-AU', 'Male')?.id).toBe('us-f')
    expect(pickVoiceFor([], 'en-US', 'Male')).toBeNull()
  })
})

describe('edgeProxyFromEnv', () => {
  it('优先 HTTPS_PROXY，兼容小写 / HTTP_PROXY', () => {
    expect(edgeProxyFromEnv({ HTTPS_PROXY: 'http://a:1', HTTP_PROXY: 'http://b:2' })).toBe('http://a:1')
    expect(edgeProxyFromEnv({ https_proxy: 'http://c:3', http_proxy: 'http://d:4' })).toBe('http://c:3')
    expect(edgeProxyFromEnv({ HTTP_PROXY: 'http://b:2' })).toBe('http://b:2')
  })

  it('没有代理返回空串', () => {
    expect(edgeProxyFromEnv({})).toBe('')
  })
})

describe('localFallbackTargets：Edge 挂了时的 Piper 兜底候选', () => {
  it('对任意 Edge 音色都不抛异常，返回的都是合法 local 目标', () => {
    // 回归：这里曾经调用一个根本没导入的 `listPiperVoices`（实际导出叫 `listLocalVoices`），
    // ReferenceError 被外层 catch 成一个 502 "tts failed: listPiperVoices is not defined"，
    // 页面里点任意一句都读不出声。这条用例只需保证「不炸 + 形状对」。
    for (const voice of ['en-US-AriaNeural', 'en-GB-RyanNeural', 'en-AU-NatashaNeural']) {
      const targets = localFallbackTargets(voice)
      expect(Array.isArray(targets)).toBe(true)
      for (const t of targets) {
        expect(t.engine).toBe('local')
        expect(t.ext).toBe('wav')
        expect(t.voice.startsWith('local:')).toBe(true)
        // 必须是白名单音色，否则 parseTarget 不会认
        expect(parseTarget(t.voice)).toEqual({ engine: 'local', voice: t.voice, ext: 'wav' })
      }
    }
  })

  it('没装 Piper 时返回空数组（交给浏览器语音），而不是抛错', () => {
    // 本机装没装 Piper 都有可能，这里只钉住「要么空数组、要么合法候选」这个契约
    const targets = localFallbackTargets('en-US-AriaNeural')
    expect(targets.length === 0 || targets.length === 1).toBe(true)
  })
})

describe('piperStatus：离线引擎为什么不可用', () => {
  it('只会返回四种结论之一，且不抛异常', () => {
    // 回归：本机（Windows）没装 Piper 时，下拉里那组「离线 · 本地语音」直接消失，
    // 界面上看不出到底是「没装」「没模型」还是「路径没找对」。把结论暴露出来。
    const status = piperStatus()
    expect(['ok', 'no-binary', 'no-voices-dir', 'no-models']).toContain(status)
  })

  it('ok 与「有音色」必须一致（不能一边说 ok 一边空列表）', () => {
    const status = piperStatus()
    const hasVoices = localFallbackTargets('en-US-AriaNeural').length > 0
    expect(status === 'ok').toBe(hasVoices)
  })
})
