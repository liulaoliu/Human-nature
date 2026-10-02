import { describe, it, expect } from 'vitest'
import {
  applyWordAnalysis,
  buildStudyQueue,
  createLibrary,
  dedupeLibrary,
  dueItems,
  editItem,
  filterItems,
  groupItems,
  isDue,
  lemmaOf,
  markWord,
  normalizeWord,
  removeByLemma,
  removeItem,
  review,
  reviewItem,
  setStatus,
  sortItems,
} from './vocab'
import type { VocabItem } from '../types/document'

const NOW = new Date('2026-10-02T00:00:00.000Z')

function item(over: Partial<VocabItem> = {}): VocabItem {
  return {
    id: 'vocab:test',
    word: 'test',
    lemma: 'test',
    phonetic: null,
    partOfSpeech: null,
    meaning: null,
    usage: [],
    examples: [],
    source: null,
    status: 'unqueried',
    note: '',
    tags: [],
    reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...over,
  }
}

describe('normalizeWord', () => {
  it('统一撇号、去标点、转小写', () => {
    expect(normalizeWord('Mississippi\u2019s,')).toBe("mississippi's")
    expect(normalizeWord('Phonics')).toBe('phonics')
  })
  it('连字符保留', () => {
    expect(normalizeWord('state-of-the-art')).toBe('state-of-the-art')
  })
})

describe('lemmaOf', () => {
  it('复数 → 原形', () => {
    expect(lemmaOf('cats')).toBe('cat')
    expect(lemmaOf('studies')).toBe('study')
    expect(lemmaOf('boxes')).toBe('box')
  })
  it('-ing / -ed → 原形', () => {
    expect(lemmaOf('running')).toBe('run')
    expect(lemmaOf('watched')).toBe('watch')
  })
  it('不规则形查表', () => {
    expect(lemmaOf('ran')).toBe('run')
    expect(lemmaOf('children')).toBe('child')
    expect(lemmaOf('went')).toBe('go')
  })
  it('所有格', () => {
    expect(lemmaOf("Mississippi's")).toBe('mississippi')
  })
  it('空词返回空串', () => {
    expect(lemmaOf('   ')).toBe('')
  })
})

describe('markWord', () => {
  it('新建词条，回填来源与例句', () => {
    const { library, item: created, created: isNew } = markWord(
      createLibrary(),
      { word: 'Running', articleId: 'a1', fileName: 'f.mp3', sentenceId: 's001', sentenceText: 'He is running fast.' },
      NOW,
    )
    expect(isNew).toBe(true)
    expect(created.lemma).toBe('run')
    expect(created.status).toBe('unqueried')
    expect(created.examples).toHaveLength(1)
    expect(created.source).toMatchObject({ articleId: 'a1', fileName: 'f.mp3', sentenceId: 's001' })
    expect(library.items).toHaveLength(1)
  })

  it('按 lemma 去重：大小写 / 变形不新建', () => {
    let lib = createLibrary()
    const first = markWord(lib, { word: 'running', articleId: 'a1', sentenceId: 's1', sentenceText: 'He is running.' }, NOW)
    lib = first.library
    const second = markWord(lib, { word: 'Runs', articleId: 'a2', sentenceId: 's2', sentenceText: 'She runs daily.' }, NOW)
    expect(second.created).toBe(false)
    expect(second.library.items).toHaveLength(1)
    expect(second.item.examples).toHaveLength(2)
    expect(second.item.source?.articleId).toBe('a1')
  })

  it('同一句重复标记不追加重复例句', () => {
    let lib = createLibrary()
    lib = markWord(lib, { word: 'run', articleId: 'a1', sentenceId: 's1', sentenceText: 'Run!' }, NOW).library
    lib = markWord(lib, { word: 'run', articleId: 'a1', sentenceId: 's1', sentenceText: 'Run!' }, NOW).library
    expect(lib.items[0].examples).toHaveLength(1)
  })

  it('空词抛错', () => {
    expect(() => markWord(createLibrary(), { word: '  ', articleId: 'a1' }, NOW)).toThrow()
  })
})

describe('applyWordAnalysis', () => {
  it('把查词结果填进已有词条', () => {
    let lib = markWord(createLibrary(), { word: 'run', articleId: 'a1', sentenceId: 's1', sentenceText: 'Run!' }, NOW).library
    lib = applyWordAnalysis(lib, [
      { word: 'running', phonetic: '/r\u028c\u014b\u026a\u014b/', partOfSpeech: 'v.', meaning: '\u8dd1', usage: ['run a business'], examples: [{ text: 'I run.', translation: '\u6211\u8dd1\u3002' }] },
    ], NOW)
    const it0 = lib.items[0]
    expect(it0.phonetic).toBe('/r\u028c\u014b\u026a\u014b/')
    expect(it0.meaning).toBe('\u8dd1')
    expect(it0.usage).toEqual(['run a business'])
    expect(it0.status).toBe('queried')
    expect(it0.examples).toHaveLength(2)
  })

  it('手动改过的含义不被覆盖', () => {
    let lib = markWord(createLibrary(), { word: 'run', articleId: 'a1' }, NOW).library
    lib = editItem(lib, lib.items[0].id, { meaning: '\u6211\u81ea\u5df1\u7684\u91ca\u4e49' }, NOW)
    lib = applyWordAnalysis(lib, [{ word: 'run', meaning: '\u8dd1' }], NOW)
    expect(lib.items[0].meaning).toBe('\u6211\u81ea\u5df1\u7684\u91ca\u4e49')
    expect(lib.items[0].status).toBe('edited')
  })

  it('没标记过的词也会建条目', () => {
    const lib = applyWordAnalysis(createLibrary(), [{ word: 'phonics', meaning: '\u81ea\u7136\u62fc\u8bfb\u6cd5' }], NOW)
    expect(lib.items).toHaveLength(1)
    expect(lib.items[0].status).toBe('queried')
    expect(lib.items[0].source).toBeNull()
  })

  it('用法去重合并', () => {
    let lib = markWord(createLibrary(), { word: 'run', articleId: 'a1' }, NOW).library
    lib = applyWordAnalysis(lib, [{ word: 'run', usage: ['run a business', 'run out'] }], NOW)
    lib = applyWordAnalysis(lib, [{ word: 'running', usage: ['run out', 'run late'] }], NOW)
    expect(lib.items[0].usage).toEqual(['run a business', 'run out', 'run late'])
  })
})

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

describe('复习排期（SM-2 变体）', () => {
  const fresh = { ease: 2.5, due: null as string | null, interval: 0, repetitions: 0 }

  it('第一次 good：1 天后', () => {
    const r = review(fresh, 'good', NOW)
    expect(r.repetitions).toBe(1)
    expect(r.interval).toBe(1)
    expect(r.due).toBe('2026-10-03T00:00:00.000Z')
  })
  it('第二次 good：6 天后', () => {
    const r = review({ ease: 2.5, due: null, interval: 1, repetitions: 1 }, 'good', NOW)
    expect(r.interval).toBe(6)
  })
  it('第三次 good：interval × ease', () => {
    const r = review({ ease: 2.5, due: null, interval: 6, repetitions: 2 }, 'good', NOW)
    expect(r.interval).toBe(15)
  })
  it('easy 提高 ease', () => {
    const r = review(fresh, 'easy', NOW)
    expect(r.ease).toBeCloseTo(2.6, 5)
  })
  it('again 重来：repetitions 归零、间隔 1 天、ease 下降', () => {
    const r = review({ ease: 2.5, due: null, interval: 15, repetitions: 3 }, 'again', NOW)
    expect(r.repetitions).toBe(0)
    expect(r.interval).toBe(1)
    expect(r.ease).toBeCloseTo(2.3, 5)
  })
  it('ease 下限 1.3', () => {
    const r = review({ ease: 1.3, due: null, interval: 1, repetitions: 1 }, 'again', NOW)
    expect(r.ease).toBe(1.3)
  })
  it('reviewItem 写回词条', () => {
    let lib = markWord(createLibrary(), { word: 'run', articleId: 'a1' }, NOW).library
    lib = reviewItem(lib, lib.items[0].id, 'good', NOW)
    expect(lib.items[0].reviewState.repetitions).toBe(1)
  })
  it('isDue / dueItems', () => {
    const due = item({ id: 'vocab:d', lemma: 'due', reviewState: { ease: 2.5, due: '2026-09-01T00:00:00.000Z', interval: 1, repetitions: 1 } })
    const future = item({ id: 'vocab:e', lemma: 'future', reviewState: { ease: 2.5, due: '2027-01-01T00:00:00.000Z', interval: 1, repetitions: 1 } })
    expect(isDue(due, NOW)).toBe(true)
    expect(isDue(future, NOW)).toBe(false)
    expect(dueItems([future, due], NOW).map((x) => x.lemma)).toEqual(['due'])
  })
})

describe('lemmaOf 短语', () => {
  it('含空格的短语不做词形还原，保持原样（小写）', () => {
    expect(lemmaOf('human rights')).toBe('human rights')
    expect(lemmaOf('Climate Change')).toBe('climate change')
  })
})

describe('dedupeLibrary / buildStudyQueue', () => {
  it('同 lemma 合并，字段互补', () => {
    const a = item({ id: 'vocab:run', lemma: 'run', word: 'run', phonetic: '/rʌn/', status: 'unqueried' })
    const b = item({ id: 'vocab:run2', lemma: 'run', word: 'running', meaning: '跑', usage: ['run out'] })
    const lib = dedupeLibrary({ schemaVersion: 1, items: [a, b] })
    expect(lib.items).toHaveLength(1)
    expect(lib.items[0]).toMatchObject({ phonetic: '/rʌn/', meaning: '跑' })
    expect(lib.items[0].usage).toEqual(['run out'])
  })
  it('不同 lemma 不动', () => {
    const lib = dedupeLibrary({ schemaVersion: 1, items: [item({ id: 'a', lemma: 'a' }), item({ id: 'b', lemma: 'b' })] })
    expect(lib.items).toHaveLength(2)
  })
  it('学习队列：到期 → 新词 → 其它', () => {
    const now = new Date('2026-10-02T00:00:00Z')
    const due = item({ id: 'd', lemma: 'due', reviewState: { ease: 2.5, due: '2026-09-01T00:00:00Z', interval: 1, repetitions: 2 } })
    const fresh = item({ id: 'f', lemma: 'fresh', reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 } })
    const later = item({ id: 'l', lemma: 'later', reviewState: { ease: 2.5, due: '2027-01-01T00:00:00Z', interval: 5, repetitions: 3 } })
    expect(buildStudyQueue([later, fresh, due], now).map((x) => x.lemma)).toEqual(['due', 'fresh', 'later'])
  })
})
