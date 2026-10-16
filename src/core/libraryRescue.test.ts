import { describe, it, expect } from 'vitest'
import { countRescueWords, recoverLibrary, rescueLibrary } from './libraryRescue'
import { createLibrary, markWord } from './vocab'
import { TEST_NOW } from './testFixtures'

/**
 * 词库救援：从「待选清单 / 错题本」把词条捞回来（丢词事故的兜底）。
 * 关注三件事：能建、幂等、脏数据不炸。
 */
describe('rescueLibrary', () => {
  it('待选清单 → 建词条（带来源句与文章）', () => {
    const out = rescueLibrary(
      createLibrary(),
      {
        batch: {
          'A 篇': [{ word: 'run', sentence: 'I run every day.', sentenceId: 's1' }],
          'B 篇': [{ word: 'wall', sentence: 'The wall is high.' }],
        },
      },
      TEST_NOW,
    )
    expect(out.found).toBe(2)
    expect(out.added).toBe(2)
    expect(out.library.items.map((it) => it.word).sort()).toEqual(['run', 'wall'])
    const run = out.library.items.find((it) => it.word === 'run')!
    expect(run.source?.fileName).toBe('A 篇')
    expect(run.source?.sentenceText).toBe('I run every day.')
  })

  it('错题本：`vocab:run` 这种 id 抠出词；同一篇只算一次、同一个词去重', () => {
    const out = rescueLibrary(
      createLibrary(),
      {
        batch: { 'A 篇': [{ word: 'run' }, { word: 'Run' }, { word: '  ' }] },
        mistakeWords: ['vocab:run', 'vocab:wall', 'wall'],
      },
      TEST_NOW,
    )
    expect(out.found).toBe(2) // run + wall
    expect(out.added).toBe(2)
  })

  it('幂等：已有的词不重复建（第二次跑 added=0）', () => {
    const records = { batch: { 'A 篇': [{ word: 'run' }] } }
    const first = rescueLibrary(createLibrary(), records, TEST_NOW)
    const second = rescueLibrary(first.library, records, TEST_NOW)
    expect(first.added).toBe(1)
    expect(second.added).toBe(0)
    expect(second.library.items).toHaveLength(1)
    expect(second.library).toBe(first.library) // 没变化 → 同一个引用（调用方可跳过写库）
  })

  it('和已有词库合并：不覆盖用户已经查过的释义', () => {
    const lib = markWord(createLibrary(), { word: 'run', articleId: 'X' }, TEST_NOW).library
    const withMeaning = { ...lib, items: [{ ...lib.items[0], meaning: '跑', status: 'queried' as const }] }
    const out = rescueLibrary(withMeaning, { batch: { 'A 篇': [{ word: 'running', sentence: 'He is running.' }] } }, TEST_NOW)
    const run = out.library.items.find((it) => it.lemma === 'run')!
    expect(run.meaning).toBe('跑') // 原有释义保留
  })

  it('脏数据（空词、空白）不炸也不建', () => {
    const out = rescueLibrary(
      createLibrary(),
      { batch: { A: [{ word: '' }, { word: '   ' }] }, mistakeWords: ['', '   '] },
      TEST_NOW,
    )
    expect(out.found).toBe(0)
    expect(out.library.items).toHaveLength(0)
  })
})

describe('recoverLibrary（一次全捞）', () => {
  it('正文标记 + 本机记录一起收，报清各来源认出多少', () => {
    const out = recoverLibrary(
      createLibrary(),
      {
        articles: [{ id: 'A 篇', sentences: [{ id: 's1', text: 'He is ensconced.', vocab: ['ensconced', 'job'] }] }],
        records: { batch: { 'B 篇': [{ word: 'purges', sentence: 'The purges began.' }] }, mistakeWords: ['vocab:havoc'] },
      },
      TEST_NOW,
    )
    expect(out.fromMarks).toBe(2)
    expect(out.fromRecords).toBe(2)
    expect(out.added).toBe(4)
    expect(out.library.items.map((it) => it.word).sort()).toEqual(['ensconced', 'havoc', 'job', 'purges'])
  })

  it('幂等：再来一次 added=0、同一个引用', () => {
    const sources = { articles: [{ id: 'A', sentences: [{ id: 's1', text: 'x', vocab: ['run'] }] }] }
    const first = recoverLibrary(createLibrary(), sources, TEST_NOW)
    const second = recoverLibrary(first.library, sources, TEST_NOW)
    expect(second.added).toBe(0)
    expect(second.library).toBe(first.library)
  })

  it('没有素材：什么都不做', () => {
    const out = recoverLibrary(createLibrary(), {}, TEST_NOW)
    expect(out.added).toBe(0)
    expect(out.library.items).toHaveLength(0)
  })
})

describe('countRescueWords（先看数）', () => {
  it('待选清单 / 错题本 各算多少，去重且不重复计', () => {
    const n = countRescueWords({
      batch: { A: [{ word: 'run' }, { word: 'Run' }], B: [{ word: 'wall' }] },
      mistakeWords: ['vocab:run', 'vocab:havoc', 'wall'],
    })
    expect(n).toEqual({ batch: 2, mistakes: 1, total: 3 }) // havoc 才算错题本新增
  })
  it('空记录 → 全 0', () => {
    expect(countRescueWords({})).toEqual({ batch: 0, mistakes: 0, total: 0 })
  })
})
