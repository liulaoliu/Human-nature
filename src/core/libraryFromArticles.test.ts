import { describe, it, expect } from 'vitest'
import { rebuildFromArticleMarks, wordsFromArticleMarks } from './libraryFromArticles'
import { createLibrary, markWord } from './vocab'
import { TEST_NOW } from './testFixtures'

/**
 * 从正文标记重建词条（丢词事故的**最准**那条路：那是当年真正标过的词）。
 * 关键：不依赖词库（词库空了也能重建）、幂等、带原句。
 */
const articles = [
  {
    id: 'A 篇',
    sentences: [
      { id: 's1', text: 'He is ensconced in the job.', vocab: ['ensconced', 'job'] },
      { id: 's2', text: 'The purges began.', vocab: ['purges', 'ensconced'] },
    ],
  },
  { id: 'B 篇', sentences: [{ id: 's1', text: 'Plain sentence.', vocab: [] }] },
]

describe('wordsFromArticleMarks', () => {
  it('抽出词 + 出处（跨句去重，保留第一次出现的句子）', () => {
    const out = wordsFromArticleMarks(articles)
    expect(out.map((w) => w.word)).toEqual(['ensconced', 'job', 'purges'])
    expect(out[0]).toMatchObject({ articleId: 'A 篇', sentenceId: 's1', sentenceText: 'He is ensconced in the job.' })
  })

  it('没有 vocab 的句子/文章不炸', () => {
    expect(wordsFromArticleMarks([{ id: 'C', sentences: [{ id: 's1', text: 'x' }] }])).toEqual([])
    expect(wordsFromArticleMarks([])).toEqual([])
  })
})

describe('rebuildFromArticleMarks', () => {
  it('词库空了也能重建：词 + 来源句都在', () => {
    const out = rebuildFromArticleMarks(createLibrary(), articles, TEST_NOW)
    expect(out.found).toBe(3)
    expect(out.added).toBe(3)
    const ens = out.library.items.find((it) => it.word === 'ensconced')!
    expect(ens.source?.fileName).toBe('A 篇')
    expect(ens.source?.sentenceText).toBe('He is ensconced in the job.')
    expect(ens.examples[0].text).toBe('He is ensconced in the job.')
  })

  it('幂等：再跑一次不新增、也不改动（同一个引用）', () => {
    const first = rebuildFromArticleMarks(createLibrary(), articles, TEST_NOW)
    const second = rebuildFromArticleMarks(first.library, articles, TEST_NOW)
    expect(second.added).toBe(0)
    expect(second.library).toBe(first.library)
  })

  it('不覆盖已有的词条（释义保留）', () => {
    const lib = markWord(createLibrary(), { word: 'purges', articleId: 'X' }, TEST_NOW).library
    const withMeaning = { ...lib, items: [{ ...lib.items[0], meaning: '清洗', status: 'queried' as const }] }
    const out = rebuildFromArticleMarks(withMeaning, articles, TEST_NOW)
    expect(out.library.items.find((it) => it.lemma === 'purge')!.meaning).toBe('清洗')
  })
})
