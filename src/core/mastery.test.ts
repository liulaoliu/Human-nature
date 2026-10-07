import { describe, it, expect } from 'vitest'
import { buildArticleMastery, isStable } from './mastery'

describe('buildArticleMastery', () => {
  it('没有生词时给最低分并提示先建词', () => {
    const m = buildArticleMastery({
      words: { total: 0, stable: 0, due: 0, lapsed: 0, fresh: 0 },
      reading: { sentences: 0, translated: 0, language: 0 },
      skills: {},
      mistakes: { words: 0, sentences: 0 },
    })
    expect(m.score).toBe(0)
    expect(m.next).toContain('自动标词')
    expect(m.enough).toBe(false)
  })

  it('词全稳定 + 精读满 + 技能满分 → 100', () => {
    const m = buildArticleMastery({
      words: { total: 10, stable: 10, due: 0, lapsed: 0, fresh: 0 },
      reading: { sentences: 10, translated: 10, language: 10 },
      skills: { quiz: { total: 10, correct: 10 } },
      mistakes: { words: 0, sentences: 0 },
    })
    expect(m.score).toBe(100)
    expect(m.grade).toBe('很熟')
    expect(m.enough).toBe(true)
  })

  it('错题会扣分', () => {
    const base = {
      words: { total: 10, stable: 10, due: 0, lapsed: 0, fresh: 0 },
      reading: { sentences: 10, translated: 10, language: 10 },
      skills: { quiz: { total: 10, correct: 10 } },
    }
    const clean = buildArticleMastery({ ...base, mistakes: { words: 0, sentences: 0 } })
    const dirty = buildArticleMastery({ ...base, mistakes: { words: 3, sentences: 1 } })
    expect(dirty.score).toBeLessThan(clean.score)
  })

  it('只有词/精读数据时 enough=false，词汇分正确', () => {
    const m = buildArticleMastery({
      words: { total: 10, stable: 5, due: 1, lapsed: 0, fresh: 2 },
      reading: { sentences: 10, translated: 5, language: 0 },
      skills: {},
      mistakes: { words: 0, sentences: 0 },
    })
    expect(m.enough).toBe(false)
    expect(m.dimensions.find((d) => d.key === 'words')?.score).toBe(50)
  })
})

describe('isStable', () => {
  it('重复≥2、间隔≥6、无错才算稳定', () => {
    expect(isStable({ reviewState: { repetitions: 2, interval: 6, lapses: 0 } })).toBe(true)
    expect(isStable({ reviewState: { repetitions: 2, interval: 6, lapses: 1 } })).toBe(false)
    expect(isStable({ reviewState: { repetitions: 1, interval: 6, lapses: 0 } })).toBe(false)
  })
})
