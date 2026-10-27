import { describe, expect, it } from 'vitest'
import { buildArticlePackage, ARTICLE_PACKAGE_FORMAT } from './articlePackage'
import { sentenceFixture, vocabItem } from './testFixtures'
import type { SavedArticle, VocabLibrary } from '../types/document'

/**
 * 文章包口径：只带选中篇的正文 / 词条 / 语言点 / 学习记录，
 * 全局统计（活动、学习时长、选词会话）不随单篇走。
 */

const article = (id: string, title: string, sourceKey: string | null): SavedArticle => ({
  id,
  title,
  sourceKey,
  text: 'Hello.',
  paragraphs: [{ id: 'p1', sentenceIds: ['s1'] }],
  sentences: [sentenceFixture('s1', 'Hello.', { translation: '你好。', languages: [{ id: 'l1' } as never] })],
  updatedAt: '2026-10-01T00:00:00.000Z',
})

const A = article('saved:A', 'A 篇', 'a-key')
const B = article('saved:B', 'B 篇', 'b-key')
const MANUAL = article('saved:M', '手动篇', null)

const run = vocabItem({
  id: 'v-run',
  word: 'run',
  lemma: 'run',
  source: { articleId: 'a-key', fileName: null, sentenceId: 's1', sentenceText: 'Hello run.' },
  contexts: [
    { articleId: 'a-key', fileName: null, sentenceId: 's1', sentenceText: 'Hello run.', at: '2026-10-01T00:00:00.000Z' },
    { articleId: 'b-key', fileName: null, sentenceId: 's2', sentenceText: 'Run there.', at: '2026-10-02T00:00:00.000Z' },
  ],
})
const fall = vocabItem({
  id: 'v-fall',
  word: 'fall back on',
  lemma: 'fall back on',
  kind: 'phrase',
  source: null,
})
const other = vocabItem({
  id: 'v-other',
  word: 'other',
  lemma: 'other',
  source: { articleId: 'b-key', fileName: null, sentenceId: 's2', sentenceText: 'Other.' },
})
const manualWord = vocabItem({
  id: 'v-manual',
  word: 'manual',
  lemma: 'manual',
  source: { articleId: '手动篇', fileName: null, sentenceId: 's1', sentenceText: 'Manual.' },
})

const library: VocabLibrary = {
  schemaVersion: 3,
  items: [run, fall, other, manualWord],
  articleEntries: [
    { articleId: 'a-key', lemma: 'run', origin: 'auto', addedAt: '2026-10-01T00:00:00.000Z' },
    { articleId: 'a-key', lemma: 'fall back on', origin: 'manual', addedAt: '2026-10-01T00:00:00.000Z' },
    { articleId: 'b-key', lemma: 'other', origin: 'auto', addedAt: '2026-10-02T00:00:00.000Z' },
    { articleId: '手动篇', lemma: 'manual', origin: 'manual', addedAt: '2026-10-03T00:00:00.000Z' },
  ],
  sentenceTexts: {
    'a-key\u0000s1': 'Hello run.',
    'b-key\u0000s2': 'Run there.',
    '手动篇\u0000s1': 'Manual.',
  },
  tombstones: [
    { kind: 'item', key: 'item:v-fall', at: '2026-10-04T00:00:00.000Z', lemma: 'fall back on' },
    { kind: 'item', key: 'item:v-other', at: '2026-10-04T00:00:00.000Z', lemma: 'other' },
    { kind: 'article', key: 'article:b-key\u0000run', at: '2026-10-04T00:00:00.000Z', lemma: 'run' },
  ],
}

const learning = {
  practice: [
    { at: '2026-10-01T00:00:00.000Z', kind: 'quiz' as const, total: 5, correct: 4, articleId: 'a-key' },
    { at: '2026-10-02T00:00:00.000Z', kind: 'quiz' as const, total: 5, correct: 3, articleId: 'b-key' },
    { at: '2026-10-03T00:00:00.000Z', kind: 'quiz' as const, total: 5, correct: 2 },
  ],
  mistakes: [
    { id: 'listening:a-key:q1', kind: 'listen' as const, at: '2026-10-01T00:00:00.000Z', count: 1, label: 'A 听力', articleId: 'a-key' },
    { id: 'exam:v-run', kind: 'vocab' as const, at: '2026-10-02T00:00:00.000Z', count: 2, label: 'run', itemId: 'v-run' },
    { id: 'exam:v-other', kind: 'vocab' as const, at: '2026-10-02T00:00:00.000Z', count: 1, label: 'other', itemId: 'v-other' },
  ],
  readDone: [
    { day: '2026-10-01', articleId: 'a-key', title: 'A 篇', at: '2026-10-01T00:00:00.000Z' },
    { day: '2026-10-02', articleId: 'b-key', title: 'B 篇', at: '2026-10-02T00:00:00.000Z' },
  ],
  writingHistory: [
    { at: '2026-10-01T00:00:00.000Z', articleId: 'a-key', model: 'm', text: 'x', feedback: {} as never },
    { at: '2026-10-02T00:00:00.000Z', articleId: 'b-key', model: 'm', text: 'y', feedback: {} as never },
  ],
  backTranslations: [
    { id: 'bt-a', at: '2026-10-01T00:00:00.000Z', articleId: 'a-key', sentenceId: 's1', sourceZh: '你好', answer: 'hi', reference: 'hello', feedback: {} as never, closeness: { exact: false, ratio: 0 } },
    { id: 'bt-b', at: '2026-10-02T00:00:00.000Z', articleId: 'b-key', sentenceId: 's2', sourceZh: '跑', answer: 'run', reference: 'run', feedback: {} as never, closeness: { exact: true, ratio: 1 } },
  ],
  retells: [
    { at: '2026-10-01T00:00:00.000Z', articleId: 'a-key', text: 'a', words: 1 },
    { at: '2026-10-02T00:00:00.000Z', articleId: 'b-key', text: 'b', words: 1 },
  ],
  skimmed: ['a-key', 'b-key'],
  answerEvents: [
    { at: '2026-10-01T00:00:00.000Z', day: '2026-10-01', articleId: 'a-key', source: 'quiz' as const, kind: 'cloze', cat: 'vocab' as const, correct: true },
    { at: '2026-10-02T00:00:00.000Z', day: '2026-10-02', articleId: 'b-key', source: 'quiz' as const, kind: 'cloze', cat: 'vocab' as const, correct: false },
    { at: '2026-10-03T00:00:00.000Z', day: '2026-10-03', articleId: '', source: 'quiz' as const, kind: 'cloze', cat: 'vocab' as const, correct: true },
  ],
  goldenDrills: [
    { id: 'a-key|s1|k', articleId: 'a-key', sentenceId: 's1', drillKey: 'k', at: '2026-10-01T00:00:00.000Z', mastered: true },
    { id: 'b-key|s2|k', articleId: 'b-key', sentenceId: 's2', drillKey: 'k', at: '2026-10-02T00:00:00.000Z', mastered: false },
  ],
}

const build = (ids: string[]) =>
  buildArticlePackage({
    articles: [A, B, MANUAL],
    articleIds: ids,
    library,
    learning,
    exportedAt: '2026-10-05T00:00:00.000Z',
  })

describe('buildArticlePackage：只带选中篇', () => {
  it('正文 / 词条 / 按篇收录 / 句子原文都按归属键过滤', () => {
    const pkg = build([A.id])
    expect(pkg.format).toBe(ARTICLE_PACKAGE_FORMAT)
    expect(pkg.exportedAt).toBe('2026-10-05T00:00:00.000Z')
    expect(pkg.articles.map((a) => a.id)).toEqual(['saved:A'])
    // AI 结果在文章句子里，整篇带走
    expect(pkg.articles[0].sentences[0].translation).toBe('你好。')

    expect(pkg.library.articleEntries?.map((e) => e.lemma).sort()).toEqual(['fall back on', 'run'])
    // run 由按篇收录带进来；fall back on 只在按篇收录里；other 属于 B 篇
    expect(pkg.library.items.map((it) => it.lemma).sort()).toEqual(['fall back on', 'run'])
    expect(pkg.library.sentenceTexts).toEqual({
      'a-key\u0000s1': 'Hello run.',
      // run 是跨篇词条，它在 B 篇的语境也要带上原文（词条本身是全局的）
      'b-key\u0000s2': 'Run there.',
    })
    expect(pkg.library.tombstones?.map((t) => t.lemma)).toEqual(['fall back on'])
  })

  it('学习记录只带能归属到这一篇的；全局统计不出现', () => {
    const pkg = build([A.id])
    expect(pkg.practice?.map((p) => p.articleId)).toEqual(['a-key'])
    // 听力错题按 articleId、词条错题按 itemId（只带本篇词条）
    expect(pkg.mistakes?.map((m) => m.id)).toEqual(['listening:a-key:q1', 'exam:v-run'])
    expect(pkg.readDone?.map((r) => r.articleId)).toEqual(['a-key'])
    expect(pkg.writingHistory?.map((w) => w.articleId)).toEqual(['a-key'])
    expect(pkg.backTranslations?.map((b) => b.articleId)).toEqual(['a-key'])
    expect(pkg.retells?.map((r) => r.articleId)).toEqual(['a-key'])
    expect(pkg.skimmed).toEqual(['a-key'])
    expect(pkg.answerEvents?.map((e) => e.articleId)).toEqual(['a-key'])
    expect(pkg.goldenDrills?.map((r) => r.articleId)).toEqual(['a-key'])
    for (const global of ['activity', 'studyDays', 'sessions', 'studiedDays', 'kindStats', 'readGoal', 'goalMemo']) {
      expect(pkg).not.toHaveProperty(global)
    }
  })

  it('多篇一起导：两篇的条目都带上，不混进第三篇', () => {
    const pkg = build([A.id, B.id])
    expect(pkg.articles.map((a) => a.id)).toEqual(['saved:A', 'saved:B'])
    expect(pkg.library.items.map((it) => it.lemma).sort()).toEqual(['fall back on', 'other', 'run'])
    expect(pkg.skimmed).toEqual(['a-key', 'b-key'])
    expect(pkg.practice).toHaveLength(2)
    expect(pkg.goldenDrills).toHaveLength(2)
  })

  it('手动粘贴的文章：旧数据按标题归属也能带出来', () => {
    const pkg = build([MANUAL.id])
    expect(pkg.library.items.map((it) => it.lemma)).toEqual(['manual'])
    expect(pkg.library.articleEntries?.map((e) => e.articleId)).toEqual(['手动篇'])
    expect(pkg.library.sentenceTexts).toEqual({ '手动篇\u0000s1': 'Manual.' })
  })

  it('没选文章 / 文章不存在：空包，不报错', () => {
    const pkg = build(['nope'])
    expect(pkg.articles).toEqual([])
    expect(pkg.library.items).toEqual([])
    expect(pkg.library.articleEntries).toEqual([])
    expect(pkg.practice).toEqual([])
    expect(pkg.mistakes).toEqual([])
    expect(pkg.goldenDrills).toEqual([])
  })

  it('同一词条被多条记录引用时只出现一次', () => {
    const pkg = build([A.id])
    expect(pkg.library.items.filter((it) => it.id === 'v-run')).toHaveLength(1)
  })
})
