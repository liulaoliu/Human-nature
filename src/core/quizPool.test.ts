import { describe, expect, it } from 'vitest'
import { buildQuizSet, poolFor, poolSizes, QUIZ_SCOPES, studyableItems, type PoolContext } from './quizPool'
import type { VocabItem } from '../types/document'

const NOW = new Date('2026-10-20T00:00:00.000Z')

function item(over: Partial<VocabItem> = {}): VocabItem {
  return {
    id: 'vocab:run',
    word: 'run',
    lemma: 'run',
    phonetic: null,
    partOfSpeech: 'v.',
    meaning: '跑',
    usage: [],
    examples: [],
    source: null,
    status: 'unqueried',
    note: '',
    tags: [],
    reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  }
}

const ctx = (over: Partial<PoolContext> = {}): PoolContext => ({
  articleIdentity: 'a1',
  docLemmas: new Set<string>(),
  ...over,
})

/** due 在 NOW 之前 = 到期 */
const due = (iso: string) => ({ ease: 2.5, due: iso, interval: 1, repetitions: 1 })

const words = (items: VocabItem[]) => items.map((it) => it.word).sort()

const items: VocabItem[] = [
  item({
    id: 'vocab:run',
    word: 'run',
    lemma: 'run',
    source: { articleId: 'a1', fileName: 'a1', sentenceId: null, sentenceText: 'I run.' },
  }),
  item({
    id: 'vocab:walk',
    word: 'walk',
    lemma: 'walk',
    status: 'mastered',
    reviewState: due('2026-10-01T00:00:00.000Z'),
  }),
  item({ id: 'vocab:jump', word: 'jump', lemma: 'jump', reviewState: due('2026-12-01T00:00:00.000Z') }),
  item({ id: 'vocab:read', word: 'read', lemma: 'read', reviewState: { ...due('2026-12-01T00:00:00.000Z'), lapses: 2 } }),
  item({ id: 'vocab:note', word: 'go on', lemma: 'go on', kind: 'usage' }), // 用法笔记：不出题
]

describe('studyableItems：用法笔记不进候选池', () => {
  it('滤掉 usage', () => {
    expect(words(studyableItems(items))).toEqual(['jump', 'read', 'run', 'walk'])
  })
})

describe('poolFor：每个范围取哪一批', () => {
  const studyable = studyableItems(items)

  it('all：全都要', () => {
    expect(words(poolFor(studyable, 'all', ctx(), NOW))).toEqual(['jump', 'read', 'run', 'walk'])
  })

  it('due：只取已到期的', () => {
    expect(words(poolFor(studyable, 'due', ctx(), NOW))).toEqual(['walk'])
  })

  it('lapses：只看常错的', () => {
    expect(words(poolFor(studyable, 'lapses', ctx(), NOW))).toEqual(['read'])
  })

  it('unmastered：排除已掌握', () => {
    expect(words(poolFor(studyable, 'unmastered', ctx(), NOW))).toEqual(['jump', 'read', 'run'])
  })

  it('article：来源是本篇，或 lemma 在本篇出现过', () => {
    expect(words(poolFor(studyable, 'article', ctx(), NOW))).toEqual(['run'])
    expect(words(poolFor(studyable, 'article', ctx({ docLemmas: new Set(['jump']) }), NOW))).toEqual(['jump', 'run'])
  })

  it('空池：没有词就返回空（不抛）', () => {
    expect(poolFor([], 'all', ctx(), NOW)).toEqual([])
  })
})

describe('poolSizes：按当前题型数题量', () => {
  it('all / due / unmastered 三个数', () => {
    const studyable = studyableItems(items)
    const sizes = poolSizes(studyable, ['spell'], NOW)
    expect(sizes.all).toBe(4)
    expect(sizes.due).toBe(1)
    expect(sizes.unmastered).toBe(3)
  })

  it('题型为空 → 都数成 0（不炸）', () => {
    expect(poolSizes(studyableItems(items), [], NOW)).toEqual({ all: 0, due: 0, unmastered: 0 })
  })
})

describe('QUIZ_SCOPES：取值表与类型对齐', () => {
  it('五个范围都在', () => {
    expect([...QUIZ_SCOPES]).toEqual(['all', 'article', 'unmastered', 'due', 'lapses'])
  })
})

describe('buildQuizSet：每词最多一题 / 允许同词多题型', () => {
  const pool = ['run', 'walk', 'jump', 'read', 'open'].map((w) =>
    item({ id: `vocab:${w}`, word: w, lemma: w, meaning: `${w} 的意思`, examples: [{ text: `I ${w} daily.` }] }),
  )

  it('unique 开着：每个词最多一题', () => {
    const qs = buildQuizSet(pool, ['spell', 'cloze'], true)
    expect(qs.length).toBeGreaterThan(0)
    expect(qs.length).toBeLessThanOrEqual(pool.length)
    expect(new Set(qs.map((q) => q.itemId)).size).toBe(qs.length)
  })

  it('关掉 unique：同一个词可以出多道题', () => {
    const one = buildQuizSet(pool, ['spell', 'cloze'], true)
    const many = buildQuizSet(pool, ['spell', 'cloze'], false)
    expect(many.length).toBeGreaterThan(one.length)
  })

  it('题型为空：出不了题（不炸）', () => {
    expect(buildQuizSet(pool, [], true)).toEqual([])
  })
})
