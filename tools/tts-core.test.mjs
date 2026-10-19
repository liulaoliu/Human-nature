import { describe, expect, it } from 'vitest'
import { parseTarget } from './tts-core.mjs'

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

  it('本机 espeak-ng 只认白名单', () => {
    expect(parseTarget('local:en-us')).toEqual({
      engine: 'local',
      voice: 'local:en-us',
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
