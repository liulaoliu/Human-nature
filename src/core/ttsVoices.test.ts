import { describe, expect, it } from 'vitest'
import { TTS_ACCENTS, buildTtsAccents, engineVoiceAccent, isOfflineTtsVoice } from './ttsVoices'

describe('isOfflineTtsVoice', () => {
  it('识别 SAPI / Piper，不误伤 Edge', () => {
    expect(isOfflineTtsVoice('sapi:Microsoft Zira Desktop')).toBe(true)
    expect(isOfflineTtsVoice('local:piper-us-lessac')).toBe(true)
    expect(isOfflineTtsVoice('en-US-AriaNeural')).toBe(false)
    expect(isOfflineTtsVoice('')).toBe(false)
  })
})

describe('engineVoiceAccent', () => {
  it('清洗 SAPI 名称并映射性别', () => {
    expect(
      engineVoiceAccent('SAPI', {
        available: true,
        voices: [
          {
            id: 'sapi:Microsoft Zira Desktop',
            name: 'Microsoft Zira Desktop',
            gender: 'Male',
            lang: 'en-US',
          },
        ],
      }),
    ).toEqual({
      label: 'SAPI',
      voices: [{ id: 'sapi:Microsoft Zira Desktop', name: 'Zira（en-US）', gender: '男' }],
    })
  })

  it('没有音色 / 不可用返回 null', () => {
    expect(engineVoiceAccent('x', { available: true, voices: [] })).toBeNull()
    expect(
      engineVoiceAccent('x', {
        available: false,
        voices: [{ id: 'local:piper-us-lessac', name: 'Piper 美音 Lessac' }],
      }),
    ).toBeNull()
    expect(engineVoiceAccent('x', null)).toBeNull()
  })

  it('本地音色保留名字并标注语言', () => {
    const accent = engineVoiceAccent('本地', {
      available: true,
      voices: [
        { id: 'local:piper-us-lessac', name: 'Piper 美音 Lessac', gender: 'Female', lang: 'en-US' },
      ],
    })
    expect(accent?.voices[0]).toEqual({
      id: 'local:piper-us-lessac',
      name: 'Piper 美音 Lessac（en-US）',
      gender: '女',
    })
  })
})

describe('buildTtsAccents', () => {
  it('探测失败时与旧版一致，只有 Edge', () => {
    expect(buildTtsAccents(null)).toEqual(TTS_ACCENTS)
    expect(buildTtsAccents(undefined)).toEqual(TTS_ACCENTS)
  })

  it('把本地 / SAPI 分组追加在 Edge 后面', () => {
    const out = buildTtsAccents({
      local: {
        available: true,
        voices: [{ id: 'local:piper-us-lessac', name: 'Piper 美音 Lessac', gender: 'Male', lang: 'en-US' }],
      },
      sapi: {
        available: true,
        voices: [
          {
            id: 'sapi:Microsoft Zira Desktop',
            name: 'Microsoft Zira Desktop',
            gender: 'Female',
            lang: 'en-US',
          },
        ],
      },
    })
    expect(out).toHaveLength(TTS_ACCENTS.length + 2)
    expect(out.at(-2)?.label).toContain('本地语音')
    expect(out.at(-2)?.voices[0].id).toBe('local:piper-us-lessac')
    expect(out.at(-1)?.label).toContain('系统语音')
    expect(out.at(-1)?.voices[0].name).toBe('Zira（en-US）')
  })

  it('不可用或空音色的引擎不出现', () => {
    const out = buildTtsAccents({
      local: { available: false, voices: [] },
      sapi: { available: true, voices: [] },
    })
    expect(out).toEqual(TTS_ACCENTS)
  })
})
