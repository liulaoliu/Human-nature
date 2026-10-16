import { describe, it, expect } from 'vitest'
import { contentKinds, planPrint, type PrintArticleRef } from './printPlan'
import { vocabItem } from './testFixtures'

/**
 * 打印/导出选片计划（从 ExportPanel 里抽出来的那 150 行领域判断）。
 * 这些用例就是原来测不到的部分：按日期/未打印/多选文章/内容口径/标题命名。
 */

const item = (over: Partial<Parameters<typeof vocabItem>[0]>) => vocabItem(over)
const refA: PrintArticleRef = { id: 'A', title: 'A 篇', lemmas: new Set(['run']) }
const refB: PrintArticleRef = { id: 'B', title: 'B 篇', lemmas: new Set() }

const lib = [
  item({ id: '1', word: 'run', lemma: 'run', source: { articleId: 'A', fileName: 'A', sentenceId: 's1', sentenceText: '' }, createdAt: '2026-10-01T10:00:00+08:00' }),
  item({ id: '2', word: 'wall', lemma: 'wall', source: { articleId: 'B', fileName: 'B', sentenceId: 's1', sentenceText: '' }, createdAt: '2026-10-02T10:00:00+08:00', lastPrintedAt: '2026-10-02T12:00:00+08:00' }),
  item({ id: '3', word: 'fall back on', lemma: 'fall back on', kind: 'phrase', meaning: '转而依靠', source: { articleId: 'A', fileName: 'A', sentenceId: 's2', sentenceText: '' }, createdAt: '2026-10-03T10:00:00+08:00' }),
  item({ id: '4', word: '注意 run 的用法', lemma: '注意 run 的用法', kind: 'usage', source: { articleId: 'A', fileName: 'A', sentenceId: 's3', sentenceText: '' }, createdAt: '2026-10-03T11:00:00+08:00' }),
]

const base = {
  libraryItems: lib,
  articleItems: lib.filter((it) => it.source?.fileName === 'A'),
  articleTitle: 'A 篇',
  articles: [refA, refB],
  pickedArticles: new Set(['A']),
  pickedDates: new Set(['2026-10-02']),
  content: 'all' as const,
  scope: 'all' as const,
}

describe('planPrint：内容口径', () => {
  it('单词 / 词组习语 / 用法 三类各自过滤，all 不过滤', () => {
    expect(contentKinds('all')).toBeNull()
    expect(contentKinds('word')).toEqual(['word'])
    expect(contentKinds('phrases')).toEqual(['phrase', 'idiom'])
    expect(contentKinds('usage')).toEqual(['usage'])
    expect(planPrint({ ...base, content: 'word' }).pool.map((it) => it.word)).toEqual(['run', 'wall'])
    expect(planPrint({ ...base, content: 'phrases' }).pool.map((it) => it.word)).toEqual(['fall back on'])
    expect(planPrint({ ...base, content: 'usage' }).pool.map((it) => it.word)).toEqual(['注意 run 的用法'])
    expect(planPrint(base).pool).toHaveLength(4)
  })
})

describe('planPrint：范围', () => {
  it('本篇：只取这一篇（内容口径同时生效）', () => {
    const p = planPrint({ ...base, scope: 'article', content: 'word' })
    expect(p.items.map((it) => it.word)).toEqual(['run'])
    expect(p.isArticleOrder).toBe(true)
  })

  it('本篇过滤后为空 → 自动降级到全部（不卡在空范围）', () => {
    const p = planPrint({ ...base, scope: 'article', content: 'usage', articleItems: [] })
    expect(p.items).toHaveLength(1)
    expect(p.isArticleOrder).toBe(false)
  })

  it('按文章：多选多篇，同一条只算一次', () => {
    const p = planPrint({ ...base, scope: 'byArticle', pickedArticles: new Set(['A', 'B']) })
    expect(p.items.map((it) => it.id)).toEqual(['1', '3', '4', '2'])
    expect(p.articleCount.get('A')).toBe(3)
    expect(p.articleCount.get('B')).toBe(1)
  })

  it('按日期：只取选中的日子，dates 倒序列出有内容的天', () => {
    const p = planPrint({ ...base, scope: 'date', pickedDates: new Set(['2026-10-01']) })
    expect(p.items.map((it) => it.word)).toEqual(['run'])
    expect(p.dates.map(([d]) => d)).toEqual(['2026-10-03', '2026-10-02', '2026-10-01'])
  })

  it('未打印：跳过已打印过的条目', () => {
    const p = planPrint({ ...base, scope: 'unprinted' })
    expect(p.items.map((it) => it.word)).toEqual(['run', 'fall back on', '注意 run 的用法'])
    expect(p.unprinted).toHaveLength(3)
  })
})

describe('planPrint：标题命名', () => {
  it('本篇/按文章/按日期/未打印/全部 各有名字，且随内容口径变', () => {
    expect(planPrint({ ...base, scope: 'article' }).title).toBe('A 篇')
    expect(planPrint({ ...base, scope: 'article', content: 'phrases' }).title).toBe('A 篇·词组习语表')
    expect(planPrint({ ...base, scope: 'byArticle', pickedArticles: new Set(['A']) }).title).toBe('词表-A 篇')
    expect(planPrint({ ...base, scope: 'byArticle', pickedArticles: new Set(['A', 'B']) }).title).toBe('词表-2篇')
    expect(planPrint({ ...base, scope: 'date', pickedDates: new Set(['2026-10-01']) }).title).toBe('词表-新增-2026-10-01')
    expect(planPrint({ ...base, scope: 'date', pickedDates: new Set(['2026-10-01', '2026-10-02']) }).title).toBe('词表-新增-2天')
    expect(planPrint({ ...base, scope: 'unprinted', content: 'usage' }).title).toBe('全部用法笔记（未打印）')
    expect(planPrint(base).title).toBe('全部生词')
  })
})

describe('planPrint：空结果', () => {
  it('canAct 跟着结果走（没条目就禁用动作按钮）', () => {
    const empty = planPrint({ ...base, libraryItems: [], articleItems: [], scope: 'all' })
    expect(empty.canAct).toBe(false)
    expect(planPrint(base).canAct).toBe(true)
  })
})
