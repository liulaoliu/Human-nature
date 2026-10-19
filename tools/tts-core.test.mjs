import { describe, expect, it } from 'vitest'
import { edgeLangFor, edgeProxyFromEnv, parseTarget, pickVoiceFor } from './tts-core.mjs'

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

  it('本机离线音色只认白名单（Piper / espeak-ng）', () => {
    expect(parseTarget('local:piper-us-lessac')).toEqual({
      engine: 'local',
      voice: 'local:piper-us-lessac',
      ext: 'wav',
    })
    expect(parseTarget('local:en-gb-x-rp+f3')).toEqual({
      engine: 'local',
      voice: 'local:en-gb-x-rp+f3',
      ext: 'wav',
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
