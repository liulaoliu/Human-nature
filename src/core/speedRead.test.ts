import { describe, it, expect } from 'vitest'
import { targetMs, wordCount, pickDrill, checkDrill, summarize, speedCursorKey } from './speedRead'
import { articleKey } from './docSignature'
import type { Sentence } from '../types/document'

const S = (text: string, extra: Partial<Sentence> = {}): Sentence => ({
  id: 's1',
  paraId: 'p01',
  text,
  audio: null,
  translation: null,
  grammarNote: null,
  collocations: [],
  vocab: [],
  tags: [],
  reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
  ...extra,
})

describe('speedRead', () => {
  it('词数与目标时长（含思考余量 + 下限）', () => {
    expect(wordCount('one two three')).toBe(3)
    const t = targetMs('a b c d e', 60) // 5 词 / 60wpm = 5 秒 + 1.5 秒余量
    expect(t).toBe(6500)
    expect(targetMs('x')).toBeGreaterThanOrEqual(2000) // 下限
  })

  it('优先挖语言点搭配，且给出四选一', () => {
    const s = S('Investments in renewables are ramping up.', { language: { phrases: ['ramp up'] } })
    const d = pickDrill(s)
    expect(d?.via).toBe('phrase')
    expect(d?.prompt).toContain('____')
    expect(d?.options).toHaveLength(4)
    expect(d?.options).toContain(d?.answer)
    expect(checkDrill(d!, d!.answer)).toBe(true)
  })

  it('语言点在 languages[] 里（新结构 / 手动改过的旧数据）同样优先挖搭配', () => {
    const s = S('Investments in renewables are ramping up.', {
      languages: [{ phrases: ['ramp up'], source: 'ai' }],
    })
    const d = pickDrill(s)
    expect(d?.via).toBe('phrase')
    expect(d?.answer.toLowerCase()).toBe('ramping')
  })

  it('没有语言点时挖生词', () => {
    const s = S('The generator transforms rotation into power.', { vocab: ['rotation'] })
    const d = pickDrill(s)
    expect(d?.via).toBe('vocab')
  })

  it('判分忽略大小写/连字符', () => {
    const d = {
      prompt: 'a ____ b',
      answer: 'well-targeted',
      accept: ['well-targeted'],
      via: 'word' as const,
      options: ['well-targeted', 'x', 'y', 'z'],
    }
    expect(checkDrill(d, 'Well Targeted')).toBe(true)
    expect(checkDrill(d, 'wrong')).toBe(false)
  })

  it('汇总平均速度与超时/拷打数', () => {
    const s = summarize([
      { words: 10, ms: 3000, slow: false, drillOk: null },
      { words: 10, ms: 6000, slow: true, drillOk: true },
    ])
    expect(s.count).toBe(2)
    expect(s.slow).toBe(1)
    expect(s.drillTotal).toBe(1)
    expect(s.drillCorrect).toBe(1)
    expect(s.avgWpm).toBe(Math.round((20 / 9000) * 60000))
  })
})

describe('speedCursorKey：速读游标不串篇', () => {
  it('键名 = articleKey：标识相同、正文不同 → 键不同', () => {
    const a = speedCursorKey(articleKey('', [S('Run fast.')]))
    const b = speedCursorKey(articleKey('', [S('Walk slow.')]))
    expect(a).not.toBe(b)
    expect(a.startsWith('reader:speedCursor:@')).toBe(true)
  })

  it('同一篇（正文一样）→ 键一样，重开能续上', () => {
    const k = articleKey('doc:1', [S('Run fast.')])
    expect(speedCursorKey(k)).toBe(speedCursorKey(k))
  })
})
