import { describe, expect, it } from 'vitest'
import { parseBackupPayload } from './backupParse'
import { createLibrary, markWord } from './vocab'
import { TEST_NOW, vocabItem } from './testFixtures'
import type { SavedArticle } from '../types/document'

const at = '2026-10-01T00:00:00.000Z'

function article(over: Partial<SavedArticle> = {}): SavedArticle {
  return {
    id: 'a1',
    title: 'A',
    sourceKey: 'a1',
    text: 'Hello.',
    paragraphs: [{ id: 'p1', sentenceIds: ['s1'] }],
    sentences: [
      {
        id: 's1',
        paraId: 'p1',
        text: 'Hello.',
        audio: null,
        translation: null,
        grammarNote: null,
        collocations: [],
        vocab: [],
        tags: [],
        reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
      },
    ],
    updatedAt: at,
    ...over,
  }
}

function library(words: string[] = ['run']) {
  let lib = createLibrary()
  for (const w of words) lib = markWord(lib, { word: w, articleId: 'a1' }, TEST_NOW).library
  return lib
}

describe('parseBackupPayload（导入运行时守卫）', () => {
  it('完整备份：文章 / 词库 / 学习记录 / 目标都解析出来', () => {
    const parsed = parseBackupPayload({
      articles: [article()],
      library: library(),
      stats: [{ at, seconds: 60, picked: 5 }],
      studyStats: [{ day: '2026-10-01', seconds: 60, cards: 3 }],
      practice: [{ at, kind: 'quiz', total: 5, correct: 4 }],
      mistakes: [{ id: 'vocab:run', kind: 'vocab', at, count: 1, label: 'run' }],
      readDone: [{ day: '2026-10-01', articleId: 'a1', title: 'A', at }],
      activity: [{ day: '2026-10-01', counts: { read: 2 } }],
      skimmed: ['a1'],
      kindStats: { a1: { quiz: { total: 5, correct: 4 } } },
      answerEvents: [
        {
          at: '2026-10-01T00:00:00.000Z',
          day: '2026-10-01',
          articleId: 'a1',
          source: 'quiz',
          kind: 'cloze',
          cat: 'vocab',
          correct: true,
        },
      ],
      backTranslations: [
        {
          id: 'bt1',
          at,
          articleId: 'a1',
          sentenceId: 's1',
          sourceZh: '你好。',
          answer: 'Hello.',
          reference: 'Hello.',
          feedback: { scores: [{ dimension: '意思还原', score: 40, max: 40 }], issues: [], alternatives: [] },
          closeness: { exact: true, ratio: 1 },
        },
      ],
      readGoal: 12,
      goalMemo: '每天一篇',
    })
    expect(parsed.articles).toHaveLength(1)
    expect(parsed.library?.items).toHaveLength(1)
    expect(parsed.sessions).toHaveLength(1)
    expect(parsed.studyDays).toHaveLength(1)
    expect(parsed.practice).toHaveLength(1)
    expect(parsed.mistakes).toHaveLength(1)
    expect(parsed.readDone).toHaveLength(1)
    expect(parsed.activity).toHaveLength(1)
    expect(parsed.skimmed).toEqual(['a1'])
    expect(parsed.kindStats?.a1.quiz).toEqual({ total: 5, correct: 4 })
    expect(parsed.answerEvents).toHaveLength(1)
    expect(parsed.backTranslations).toHaveLength(1)
    expect(parsed.readGoal).toBe(12)
    expect(parsed.goalMemo).toBe('每天一篇')
    expect(parsed.dropped).toBe(0)
  })

  it('词库坏条目被丢弃并计数，好条目保留（不整份失败）', () => {
    const parsed = parseBackupPayload({
      library: { schemaVersion: 1, items: [vocabItem({ word: 'run', lemma: 'run' }), { word: '' }, null] },
    })
    expect(parsed.library?.items).toHaveLength(1)
    expect(parsed.dropped).toBe(2)
    expect(parsed.errors.join()).toContain('词条')
  })

  it('词库全坏 / 空 → 不导入（避免把现有词库清空）', () => {
    const parsed = parseBackupPayload({ library: { schemaVersion: 1, items: [{ word: '' }] } })
    expect(parsed.library).toBeNull()
    expect(parsed.dropped).toBe(1)
    expect(parsed.errors.join()).toContain('已忽略')
  })

  it('文章缺 sentences / id 被丢弃，正文结构完整的保留', () => {
    const parsed = parseBackupPayload({
      articles: [article(), { ...article(), id: '' }, { id: 'a2', title: 'B', updatedAt: at }],
    })
    expect(parsed.articles.map((a) => a.id)).toEqual(['a1'])
    expect(parsed.dropped).toBe(2)
  })

  it('文章来源只认白名单；旧数据/坏值保持未知', () => {
    const parsed = parseBackupPayload({
      articles: [
        article({ id: 'a1', origin: 'epub' }),
        article({ id: 'a2' }),
        { ...article({ id: 'a3' }), origin: 'legacy' },
      ],
    })
    expect(parsed.articles.map((a) => [a.id, a.origin])).toEqual([
      ['a1', 'epub'],
      ['a2', undefined],
      ['a3', undefined],
    ])
  })

  it('学习记录只留结构正确的条目，坏条目计数', () => {
    const parsed = parseBackupPayload({
      practice: [{ at, kind: 'quiz', total: 5, correct: 4 }, { kind: 'quiz' }],
      skimmed: ['a1', '', 3],
      kindStats: { a1: { quiz: { total: 5, correct: 4 } }, bad: { quiz: { total: 'x' } } },
      answerEvents: [
        {
          at,
          day: '2026-10-01',
          articleId: 'a1',
          source: 'quiz',
          kind: 'cloze',
          cat: 'vocab',
          correct: true,
        },
        { at: 'bad', source: 'quiz', kind: 'cloze', cat: 'vocab', correct: true },
      ],
    })
    expect(parsed.practice).toHaveLength(1)
    expect(parsed.skimmed).toEqual(['a1'])
    expect(Object.keys(parsed.kindStats ?? {})).toEqual(['a1'])
    expect(parsed.answerEvents).toHaveLength(1)
    expect(parsed.dropped).toBe(5) // 1 条练习 + 2 个 skimmed 坏值 + 1 个坏统计行 + 1 条坏事件
  })

  it('数组形态：文章数组 / 词条数组都能认', () => {
    const asArticles = parseBackupPayload([article()])
    expect(asArticles.articles).toHaveLength(1)
    expect(asArticles.library).toBeNull()

    const asItems = parseBackupPayload([{ word: 'run', lemma: 'run' }])
    expect(asItems.library?.items).toHaveLength(1)
  })

  it('不是对象/数组：不崩，返回错误计数', () => {
    const parsed = parseBackupPayload('nope')
    expect(parsed.articles).toEqual([])
    expect(parsed.library).toBeNull()
    expect(parsed.dropped).toBe(1)
  })
})
