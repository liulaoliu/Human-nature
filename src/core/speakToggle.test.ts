import { describe, expect, it } from 'vitest'
import { nextSpeakToggle } from './speakToggle'

const base = { text: 'A quiet morning.', playingText: null, state: 'idle' as const }

describe('nextSpeakToggle', () => {
  it('空闲时按 → 从头读选中句', () => {
    expect(nextSpeakToggle(base)).toEqual({ type: 'speak', text: 'A quiet morning.' })
  })

  it('正在读同一句 → 停', () => {
    expect(nextSpeakToggle({ ...base, playingText: 'A quiet morning.', state: 'playing' })).toEqual({
      type: 'stop',
    })
  })

  it('正在合成同一句 → 也算正在读，应当停', () => {
    expect(nextSpeakToggle({ ...base, playingText: 'A quiet morning.', state: 'loading' })).toEqual({
      type: 'stop',
    })
  })

  it('停完再按 → 从头读（状态已回 idle）', () => {
    expect(nextSpeakToggle({ ...base, playingText: null, state: 'idle' })).toEqual({
      type: 'speak',
      text: 'A quiet morning.',
    })
  })

  it('正在读别的句子 → 改读选中句，不是停止', () => {
    expect(
      nextSpeakToggle({ text: 'Second one.', playingText: 'First one.', state: 'playing' }),
    ).toEqual({ type: 'speak', text: 'Second one.' })
  })

  it('整篇连播中按 → 改读选中句（连播读到的正好是这句也不停）', () => {
    expect(
      nextSpeakToggle({
        text: 'A quiet morning.',
        playingText: 'A quiet morning.',
        state: 'playing',
        readingAll: true,
      }),
    ).toEqual({ type: 'speak', text: 'A quiet morning.' })
  })

  it('文本首尾空白不影响判同', () => {
    expect(
      nextSpeakToggle({ text: '  A quiet morning.  ', playingText: 'A quiet morning.', state: 'playing' }),
    ).toEqual({ type: 'stop' })
  })

  it('没有选中文本 → 不动当前播放', () => {
    expect(nextSpeakToggle({ ...base, text: null })).toBeNull()
    expect(nextSpeakToggle({ ...base, text: '   ' })).toBeNull()
  })
})
