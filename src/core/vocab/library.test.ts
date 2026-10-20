import { describe, it, expect } from 'vitest'
import {
  articleWordsOf,
  createLibrary,
  editItem,
  filterItems,
  groupItems,
  isPrinted,
  markPrinted,
  removeByLemma,
  removeItem,
  setStatus,
  sortItems,
  unprintedItems,
} from './library'
import { markWord } from './analysis'
import { vocabItem } from '../testFixtures'

const NOW = new Date('2026-10-02T00:00:00.000Z')
const item = vocabItem

describe('编辑 / 状态 / 删除', () => {
  it('editItem 默认置为 edited', () => {
    let lib = markWord(createLibrary(), { word: 'run', articleId: 'a1' }, NOW).library
    lib = editItem(lib, lib.items[0].id, { note: '易混淆' }, NOW)
    expect(lib.items[0].note).toBe('易混淆')
    expect(lib.items[0].status).toBe('edited')
  })
  it('setStatus', () => {
    let lib = markWord(createLibrary(), { word: 'run', articleId: 'a1' }, NOW).library
    lib = setStatus(lib, lib.items[0].id, 'mastered', NOW)
    expect(lib.items[0].status).toBe('mastered')
  })
  it('removeItem / removeByLemma', () => {
    const lib = markWord(createLibrary(), { word: 'running', articleId: 'a1' }, NOW).library
    expect(removeItem(lib, lib.items[0].id).items).toHaveLength(0)
    expect(removeByLemma(lib, 'run').items).toHaveLength(0)
  })
})

describe('筛选 / 分组 / 排序', () => {
  const a = item({ id: 'vocab:a', word: 'apple', lemma: 'apple', status: 'queried', source: { articleId: 'art1', fileName: null, sentenceId: null, sentenceText: '' }, tags: ['food'] })
  const b = item({ id: 'vocab:b', word: 'banana', lemma: 'banana', status: 'unqueried', source: { articleId: 'art2', fileName: null, sentenceId: null, sentenceText: '' } })
  const c = item({ id: 'vocab:c', word: 'cherry', lemma: 'cherry', meaning: '樱桃', status: 'mastered', source: { articleId: 'art1', fileName: null, sentenceId: null, sentenceText: '' } })

  it('按状态筛选', () => {
    expect(filterItems([a, b, c], { status: ['queried', 'mastered'] }).map((x) => x.lemma)).toEqual(['apple', 'cherry'])
  })
  it('按文章筛选', () => {
    expect(filterItems([a, b, c], { articleId: 'art1' }).map((x) => x.lemma)).toEqual(['apple', 'cherry'])
  })
  it('按标签筛选', () => {
    expect(filterItems([a, b, c], { tag: 'food' }).map((x) => x.lemma)).toEqual(['apple'])
  })
  it('模糊查询命中含义', () => {
    expect(filterItems([a, b, c], { query: '樱桃' }).map((x) => x.lemma)).toEqual(['cherry'])
  })
  it('按到期日筛选', () => {
    const due = item({ id: 'vocab:d', lemma: 'due', reviewState: { ease: 2.5, due: '2026-09-01T00:00:00.000Z', interval: 1, repetitions: 1 } })
    const future = item({ id: 'vocab:e', lemma: 'future', reviewState: { ease: 2.5, due: '2027-01-01T00:00:00.000Z', interval: 1, repetitions: 1 } })
    expect(filterItems([due, future], { dueBefore: NOW }).map((x) => x.lemma)).toEqual(['due'])
  })
  it('按首字母分组', () => {
    expect(groupItems([a, c], 'alphabet').map((g) => g.key)).toEqual(['A', 'C'])
  })
  it('按文章分组', () => {
    expect(groupItems([a, b, c], 'article').map((g) => g.key)).toEqual(['art1', 'art2'])
  })
  it('按日期分组', () => {
    expect(groupItems([a, b], 'date')[0].key).toBe('2026-10-02')
  })
  it('按状态分组', () => {
    expect(groupItems([a, b, c], 'status').map((g) => g.key).sort()).toEqual(['mastered', 'queried', 'unqueried'])
  })
  it('按字母排序', () => {
    expect(sortItems([c, a, b], 'word').map((x) => x.lemma)).toEqual(['apple', 'banana', 'cherry'])
  })
  it('按到期排序，未排期的排最后', () => {
    const due = item({ id: 'vocab:d', lemma: 'due', reviewState: { ease: 2.5, due: '2026-09-01T00:00:00.000Z', interval: 1, repetitions: 1 } })
    expect(sortItems([b, due], 'due').map((x) => x.lemma)).toEqual(['due', 'banana'])
  })
})
describe('articleWordsOf（本篇生词归属）', () => {
  it('来源是本文 → 算本篇；来源在别处但正文出现过 → 也算本篇', () => {
    const lib = {
      schemaVersion: 1,
      items: [
        item({ id: 'vocab:a', lemma: 'estrange', word: 'estrange', source: { articleId: 'art-A', fileName: 'art-A', sentenceId: 's1', sentenceText: 'x' } }),
        item({ id: 'vocab:b', lemma: 'bungle', word: 'bungle', source: null }),
        item({ id: 'vocab:c', lemma: 'unrelated', word: 'unrelated', source: null }),
      ],
    }
    const docLemmas = new Set(['bungle']) // 本文正文里出现了 bungle
    const words = articleWordsOf(lib, 'art-A', docLemmas).map((it) => it.lemma).sort()
    expect(words).toEqual(['bungle', 'estrange'])
  })

  it('markWord 去重：有句子的来源优先，多篇则都进 contexts（回归）', () => {
    let lib = markWord(createLibrary(), { word: 'mitigate', articleId: 'art-A', fileName: 'art-A', sentenceText: 'A sentence.' }, NOW).library
    lib = markWord(lib, { word: 'Mitigating', articleId: 'art-B', fileName: 'art-B', sentenceText: 'B sentence.' }, NOW).library
    expect(lib.items).toHaveLength(1)
    // 有句子的来源保留 A（先来的），B 篇的语境另存 —— 不丢信息
    expect(lib.items[0].source?.fileName).toBe('art-A')
    expect(lib.items[0].contexts?.map((c) => c.fileName).sort()).toEqual(['art-A', 'art-B'])
    // 旧逻辑（只看 source）：art-B 本篇 0 个
    expect(lib.items.filter((it) => it.source?.fileName === 'art-B')).toHaveLength(0)
    // 新逻辑（正文出现过）：art-B 本篇 1 个
    expect(articleWordsOf(lib, 'art-B', new Set(['mitigate']))).toHaveLength(1)
  })

  it('来源为空时用新的（不管手动还是自动选词，来源都要带上）', () => {
    let lib = markWord(createLibrary(), { word: 'x', articleId: 'art-A' }, NOW).library // 没给句子 → 来源为空
    expect(lib.items[0].source?.sentenceText).toBe('')
    lib = markWord(lib, { word: 'x', articleId: 'art-B', fileName: 'art-B', sentenceText: 'B sentence.' }, NOW).library
    expect(lib.items[0].source?.fileName).toBe('art-B')
    expect(lib.items[0].source?.sentenceText).toBe('B sentence.')
  })
})
describe('markPrinted / unprintedItems', () => {
  it('给指定词条写上打印时间，其余不动', () => {
    let lib = markWord(createLibrary(), { word: 'run', articleId: 'a1' }, NOW).library
    lib = markWord(lib, { word: 'jump', articleId: 'a1' }, NOW).library
    const runId = lib.items.find((it) => it.lemma === 'run')!.id
    const out = markPrinted(lib, [runId], NOW)
    expect(out.items.find((it) => it.lemma === 'run')!.lastPrintedAt).toBe(NOW.toISOString())
    expect(out.items.find((it) => it.lemma === 'jump')!.lastPrintedAt).toBeUndefined()
  })
  it('isPrinted / unprintedItems 把没有 lastPrintedAt 的算作未打印', () => {
    let lib = markWord(createLibrary(), { word: 'run', articleId: 'a1' }, NOW).library
    lib = markWord(lib, { word: 'jump', articleId: 'a1' }, NOW).library
    expect(unprintedItems(lib.items)).toHaveLength(2)
    lib = markPrinted(lib, [lib.items[0].id], NOW)
    expect(isPrinted(lib.items[0])).toBe(true)
    expect(unprintedItems(lib.items)).toHaveLength(1)
  })
  it('传空集合原样返回', () => {
    const lib = markWord(createLibrary(), { word: 'run', articleId: 'a1' }, NOW).library
    expect(markPrinted(lib, [])).toBe(lib)
  })
})
