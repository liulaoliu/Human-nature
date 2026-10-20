import { describe, it, expect } from 'vitest'
import { migrateLibrary, migrateToCurrent } from './migrations'
import { libraryErrors } from './libraryValidate'
import { createLibrary } from './vocab'
import { SCHEMA_VERSION } from '../types/document'
import { TEST_NOW } from './testFixtures'

/**
 * 迁移收口 + 不变量校验。
 * 这两件事是「数据结构设计」落地的地方：**老数据能进来、坏数据能被发现**。
 */

describe('migrateLibrary：宽容解析', () => {
  it('空 / 非对象 → 空库，不炸', () => {
    expect(migrateLibrary(null).items).toEqual([])
    expect(migrateLibrary('nope').items).toEqual([])
    expect(migrateLibrary({}).schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('缺字段的老条目：补 id/lemma/时间/复习状态，保留能用的内容', () => {
    const out = migrateLibrary(
      {
        items: [
          { word: 'Run', meaning: '跑\n走', examples: [{ text: 'I run.' }], status: 'weird' },
          { word: '', lemma: 'x' }, // 无 word → 丢弃
          { noWord: true }, // 丢弃
        ],
      },
      TEST_NOW,
    )
    expect(out.items).toHaveLength(1)
    const it = out.items[0]
    expect(it.id).toBe('vocab:run')
    expect(it.lemma).toBe('run')
    expect(it.meaning).toBe('跑 走') // 清洗掉转义换行
    expect(it.status).toBe('queried') // 有释义 → queried
    expect(it.examples[0].text).toBe('I run.')
    expect(it.reviewState).toEqual({ ease: 2.5, due: null, interval: 0, repetitions: 0 })
    expect(it.createdAt).toBe(TEST_NOW.toISOString())
  })

  it('幂等：迁移两遍结果一样、引用尽量复用', () => {
    const once = migrateLibrary({ items: [{ word: 'run' }, { word: 'wall' }] }, TEST_NOW)
    const twice = migrateLibrary(once, TEST_NOW)
    expect(twice.items.map((i) => i.word)).toEqual(['run', 'wall'])
    expect(libraryErrors(twice)).toEqual([])
  })

  it('早先版本误标的类型 / 与词性不符的语法标记，一并修掉', () => {
    const out = migrateLibrary(
      {
        items: [
          { word: 'purge', lemma: 'purge', kind: 'usage' }, // 旧 bug：单词被标成用法 → 改回单词
          { word: 'run', lemma: 'run', partOfSpeech: 'adj.', grammarMarks: ['不可数'] }, // 形容词不该有「不可数」
        ],
      },
      TEST_NOW,
    )
    const purge = out.items.find((i) => i.lemma === 'purge')!
    const run = out.items.find((i) => i.lemma === 'run')!
    expect(purge.kind).toBeUndefined()
    expect(run.grammarMarks).toEqual([])
  })

  it('按 lemma 去重（老数据里同一词两条 → 合成一条）', () => {
    const out = migrateLibrary(
      { items: [{ word: 'run', lemma: 'run', meaning: '跑' }, { word: 'running', lemma: 'run', phonetic: '/rʌn/' }] },
      TEST_NOW,
    )
    expect(out.items).toHaveLength(1)
    expect(out.items[0].meaning).toBe('跑')
    expect(out.items[0].phonetic).toBe('/rʌn/')
  })
})

describe('migrateLibrary：按篇收录表', () => {
  it('老数据没有 articleEntries：只从 source / contexts 推导，不按正文出现猜', () => {
    const out = migrateLibrary(
      {
        items: [
          {
            word: 'run',
            lemma: 'run',
            createdAt: '2026-08-01T00:00:00.000Z',
            updatedAt: '2026-08-01T00:00:00.000Z',
            source: { articleId: 'A', fileName: 'A', sentenceId: 's1', sentenceText: 'I run.' },
            contexts: [
              { articleId: 'B', fileName: 'B', sentenceId: 's2', sentenceText: 'Run!', meaning: '跑', at: '2026-09-01T00:00:00.000Z' },
            ],
          },
          { word: 'done', lemma: 'done', status: 'mastered', source: { articleId: 'C', fileName: 'C', sentenceId: 's3', sentenceText: 'x' } },
        ],
      },
      TEST_NOW,
    )
    expect(out.articleEntries?.map((e) => `${e.articleId}:${e.lemma}:${e.origin}`)).toEqual([
      'A:run:manual',
      'B:run:manual',
    ])
    expect(out.articleEntries?.find((e) => e.articleId === 'B')?.meaning).toBe('跑')
    // 已掌握词不补成本篇生词
    expect(out.articleEntries?.some((e) => e.lemma === 'done')).toBe(false)
  })

  it('老数据的语言点也推导按篇条目（侧栏语言点页签靠它）', () => {
    const out = migrateLibrary(
      {
        items: [
          {
            word: 'fall back on',
            lemma: 'fall back on',
            kind: 'phrase',
            createdAt: '2026-08-01T00:00:00.000Z',
            updatedAt: '2026-08-01T00:00:00.000Z',
            source: { articleId: 'A', fileName: 'A', sentenceId: 's1', sentenceText: 'We fall back on it.' },
          },
        ],
      },
      TEST_NOW,
    )
    expect(out.articleEntries?.map((e) => `${e.articleId}:${e.lemma}`)).toEqual(['A:fall back on'])
    expect(libraryErrors(out)).toEqual([])
  })

  it('已有 articleEntries：保留合法顺序，丢掉孤儿 / 重复 / 非法条目', () => {
    const out = migrateLibrary(
      {
        items: [{ word: 'run', lemma: 'run' }],
        articleEntries: [
          { articleId: 'A', lemma: 'run', origin: 'auto', addedAt: '2026-10-01T00:00:00.000Z' },
          { articleId: 'A', lemma: 'run', origin: 'manual', addedAt: '2026-10-01T00:00:01.000Z' },
          { articleId: 'A', lemma: 'missing', origin: 'manual', addedAt: '2026-10-01T00:00:02.000Z' },
          { articleId: '', lemma: 'run', origin: 'manual', addedAt: '2026-10-01T00:00:03.000Z' },
        ],
      },
      TEST_NOW,
    )
    expect(out.articleEntries).toHaveLength(1)
    expect(out.articleEntries?.[0]).toMatchObject({
      articleId: 'A',
      lemma: 'run',
      origin: 'auto',
      addedAt: '2026-10-01T00:00:00.000Z',
    })
    expect(libraryErrors(out)).toEqual([])
  })

  it('幂等：已是当前结构时 articleEntries 引用复用', () => {
    const entries = [{ articleId: 'A', lemma: 'run', origin: 'auto' as const, addedAt: '2026-10-01T00:00:00.000Z' }]
    const first = migrateLibrary({ items: [{ word: 'run', lemma: 'run' }], articleEntries: entries }, TEST_NOW)
    const second = migrateLibrary(first, TEST_NOW)
    expect(second.articleEntries).toBe(first.articleEntries)
  })
})

describe('migrateToCurrent', () => {
  it('已是当前版本 → 原样返回', () => {
    const lib = createLibrary()
    expect(migrateToCurrent(lib)).toBe(lib)
  })
  it('老版本号 → 抬到当前版本', () => {
    expect(migrateToCurrent({ schemaVersion: 0, items: [] }).schemaVersion).toBe(SCHEMA_VERSION)
  })
})
