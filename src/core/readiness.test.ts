import { describe, it, expect } from 'vitest'
import { buildReadiness, type ReadyInput } from './readiness'

const base: ReadyInput = {
  hasDoc: true,
  sentences: 10,
  translated: 0,
  language: 0,
  listenQuiz: 0,
  vocab: 0,
  batch: 0,
  unqueried: 0,
  noMeaning: 0,
  noExampleUsage: 0,
  noPhonetic: 0,
  confusableMissing: 0,
  lemmaCandidates: 0,
  due: 0,
  newWords: 0,
  writingHistory: 0,
}

function row(input: Partial<ReadyInput>, key: string) {
  return buildReadiness({ ...base, ...input }).find((r) => r.key === key)!
}

describe('buildReadiness', () => {
  it('没打开文章：读/听/写 相关都是 blocked，并给提示', () => {
    const rows = buildReadiness({ ...base, hasDoc: false })
    expect(rows.find((r) => r.key === 'article')!.level).toBe('blocked')
    expect(rows.find((r) => r.key === 'article')!.hint).toBeTruthy()
    expect(rows.find((r) => r.key === 'dictation')!.level).toBe('blocked')
    expect(rows.find((r) => r.key === 'language')!.level).toBe('blocked')
    expect(rows.find((r) => r.key === 'imitation')!.level).toBe('blocked')
  })
  it('有文章但没生成：听力题/语言点 partial 并提示去生成', () => {
    expect(row({}, 'listen').level).toBe('partial')
    expect(row({}, 'listen').hint).toContain('出题')
    expect(row({}, 'language').level).toBe('partial')
    expect(row({}, 'language').hint).toContain('语言点')
  })
  it('生词本为空 → blocked；有词 → ready', () => {
    expect(row({ vocab: 0 }, 'vocab').level).toBe('blocked')
    expect(row({ vocab: 5, due: 2, newWords: 3 }, 'vocab').level).toBe('ready')
  })
  it('待选/未查/缺释义/缺例句/缺混淆/非原形 → partial', () => {
    expect(row({ batch: 3 }, 'batch').level).toBe('partial')
    expect(row({ unqueried: 2 }, 'unqueried').level).toBe('partial')
    expect(row({ noMeaning: 1 }, 'meaning').level).toBe('partial')
    expect(row({ noExampleUsage: 4 }, 'example').level).toBe('partial')
    expect(row({ confusableMissing: 6 }, 'confusable').level).toBe('partial')
    expect(row({ lemmaCandidates: 2 }, 'lemma').level).toBe('partial')
  })
  it('都齐了 → ready，且无 hint', () => {
    const rows = buildReadiness({ ...base, translated: 10, language: 10, listenQuiz: 8, vocab: 20, due: 5, newWords: 2 })
    for (const key of ['vocab', 'batch', 'unqueried', 'meaning', 'example', 'confusable', 'lemma', 'listen', 'language']) {
      const r = rows.find((x) => x.key === key)!
      expect(r.level).toBe('ready')
      expect(r.hint).toBeUndefined()
    }
  })
})
