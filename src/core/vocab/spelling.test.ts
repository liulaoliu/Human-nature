import { describe, it, expect } from 'vitest'
import { markSpellingMiss, spellingMatches } from './spelling'
import { createLibrary } from './library'
import { vocabItem } from '../testFixtures'

const NOW = new Date('2026-10-02T00:00:00.000Z')

describe('拼写比对', () => {
  it('大小写 / 首尾空格 / 连续空格不敏感', () => {
    expect(spellingMatches(' Run ', 'run')).toBe(true)
    expect(spellingMatches('bad   temperedly', 'bad temperedly')).toBe(true)
  })

  it('拼错一个字母就是错（不做词形兜底）', () => {
    expect(spellingMatches('ran', 'run')).toBe(false)
    expect(spellingMatches('runs', 'run')).toBe(false)
    expect(spellingMatches('', 'run')).toBe(false)
  })
})

describe('拼错 → 判为不认识并进入重学', () => {
  const lib = (): ReturnType<typeof createLibrary> => ({
    ...createLibrary(),
    items: [
      vocabItem({
        id: 'w1',
        word: 'run',
        lemma: 'run',
        meaning: '跑',
        reviewState: { ease: 2.5, due: '2026-10-02T00:00:00.000Z', interval: 15, repetitions: 3, lapses: 2 },
      }),
      vocabItem({ id: 'w2', word: 'walk', lemma: 'walk', meaning: '走' }),
    ],
  })

  it('SRS 归零、间隔 1 天、lapses +1、relearn +1', () => {
    const out = markSpellingMiss(lib(), 'w1', NOW)
    const rs = out.items.find((it) => it.id === 'w1')!.reviewState
    expect(rs.repetitions).toBe(0)
    expect(rs.interval).toBe(1)
    expect(rs.lapses).toBe(3)
    expect(rs.relearn).toBe(1)
    expect(rs.due).toBe('2026-10-03T00:00:00.000Z')
  })

  it('打上「不认识」标签（已有时不重复）', () => {
    const once = markSpellingMiss(lib(), 'w1', NOW)
    expect(once.items.find((it) => it.id === 'w1')!.tags).toEqual(['不认识'])
    const twice = markSpellingMiss(once, 'w1', NOW)
    expect(twice.items.find((it) => it.id === 'w1')!.tags).toEqual(['不认识'])
  })

  it('只改拼错的那一条，其它条目保持原引用', () => {
    const before = lib()
    const other = before.items.find((it) => it.id === 'w2')
    const out = markSpellingMiss(before, 'w1', NOW)
    expect(out.items.find((it) => it.id === 'w2')).toBe(other)
  })
})
