import { describe, it, expect } from 'vitest'
import { buildArticleQuestions } from './articleQuiz'
import { isCorrect } from './quiz'
import type { Sentence } from '../types/document'

/** 简单可复现的伪随机（LCG）。 */
function seqRnd(seed = 1): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

const S = (id: string, paraId: string, text: string, translation?: string, grammar?: string): Sentence => ({
  id,
  paraId,
  text,
  audio: null,
  translation: translation ?? null,
  grammarNote: null,
  collocations: [],
  vocab: [],
  language: grammar ? { grammar } : undefined,
  tags: [],
  reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
})

const SENTS: Sentence[] = [
  S('s1', 'p01', 'Investments in renewables are ramping up.', '对可再生能源的投资正在迅速增加。', '现在进行时表趋势'),
  S('s2', 'p01', 'But bottlenecks could still hobble reductions in emissions.', '但瓶颈仍可能拖累减排。', '情态动词 could 表可能'),
  S('s3', 'p01', 'Today companies are rushing to meet the demand.', '如今公司正竞相满足需求。', '现在进行时'),
  S('s4', 'p02', 'They also need lots of capital.', '它们还需要大量资本。', '一般现在时'),
]

describe('buildArticleQuestions', () => {
  it('英译中：每题 4 选项且含正确答案，可判对', () => {
    const qs = buildArticleQuestions(SENTS, { kinds: ['translate'], rnd: seqRnd(2) })
    expect(qs).toHaveLength(4)
    for (const q of qs) {
      expect(q.source).toBe('article')
      expect(q.options).toHaveLength(4)
      expect(q.options).toContain(q.answer)
      expect(isCorrect(q, q.answer)).toBe(true)
    }
  })

  it('中译英：题干是中文，答案是英文原句', () => {
    const qs = buildArticleQuestions(SENTS, { kinds: ['translate2'], rnd: seqRnd(3) })
    const q = qs.find((x) => x.itemId === 's1')!
    expect(q.prompt).toContain('可再生能源')
    expect(q.answer).toBe('Investments in renewables are ramping up.')
  })

  it('功能词填空：挖空且选项 4 个、答案可判对', () => {
    const qs = buildArticleQuestions(SENTS, { kinds: ['functionWord'], rnd: seqRnd(4) })
    expect(qs.length).toBeGreaterThan(0)
    for (const q of qs) {
      expect(q.prompt).toContain('____')
      expect(q.options).toHaveLength(4)
      expect(isCorrect(q, q.answer)).toBe(true)
    }
  })

  it('句子排序：一节的 3 句出 1 题，答案是可判对的字母序', () => {
    const qs = buildArticleQuestions(SENTS, { kinds: ['ordering'], rnd: seqRnd(5) })
    const q = qs.find((x) => x.itemId === 'p01')!
    expect(q).toBeTruthy()
    expect(q.options).toHaveLength(4)
    expect(q.answer).toMatch(/^[ABC] [ABC] [ABC]$/)
    expect(isCorrect(q, q.answer)).toBe(true)
  })

  it('结构/语法：有语言点时才出题，答案可判对', () => {
    const qs = buildArticleQuestions(SENTS, { kinds: ['grammar'], rnd: seqRnd(6) })
    expect(qs).toHaveLength(4)
    for (const q of qs) expect(isCorrect(q, q.answer)).toBe(true)
  })

  it('没有译文/语言点时对应题型不出题', () => {
    const bare = [S('a', 'p01', 'Hello world.'), S('b', 'p01', 'Goodbye moon.')]
    expect(buildArticleQuestions(bare, { kinds: ['translate'], rnd: seqRnd(1) })).toHaveLength(0)
    expect(buildArticleQuestions(bare, { kinds: ['grammar'], rnd: seqRnd(1) })).toHaveLength(0)
  })
})
