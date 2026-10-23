import { describe, it, expect } from 'vitest'
import {
  chunk,
  confusableChunks,
  exampleChunks,
  lookupChunks,
  markChunks,
  phraseChunks,
  pickConfusable,
  pickContextLookup,
  pickExamples,
  pickLemmas,
  pickMarks,
  pickNeedInfo,
  pickPhrases,
  pickPos,
  pickTodoBase,
  sentenceChunks,
} from './aiTodos'
import { vocabItem } from './testFixtures'

const article = (over = {}) => vocabItem({ id: 'a', word: 'a', lemma: 'a', ...over })
const filler = (n: number) => Array.from({ length: n }, (_, i) => vocabItem({ id: `w${i}`, word: `w${i}`, lemma: `w${i}` }))

describe('aiTodos 待办筛选', () => {
  it('pickTodoBase 按范围取词，并剔除词组/习语/用法条目', () => {
    const words = [vocabItem({ id: 'w1', word: 'w1', lemma: 'w1' })]
    const phrases = [vocabItem({ id: 'p1', word: 'p1', lemma: 'p1', kind: 'phrase' })]
    expect(pickTodoBase({ scope: 'article', articleWords: words, items: phrases.concat(words) })).toHaveLength(1)
    expect(pickTodoBase({ scope: 'all', articleWords: phrases, items: phrases })).toHaveLength(0)
  })

  it('pickNeedInfo：没有释义的都要补（查过但没查到也算），只差音标的只补从没查过的', () => {
    const todo = vocabItem({ status: 'unqueried', phonetic: null, meaning: null })
    const hasInfo = vocabItem({ status: 'unqueried', phonetic: '/x/', meaning: '义' })
    // 查过一次、但一条释义都没拿到 —— 不重排的话这就是一张永远空着的卡
    const triedButEmpty = vocabItem({ status: 'queried', phonetic: null, meaning: null })
    // 有释义、只差音标：不重排，免得半成品被无限重试
    const onlyPhonetic = vocabItem({ status: 'queried', phonetic: null, meaning: '义' })
    // 手填过的释义不动
    const manual = vocabItem({ status: 'queried', meaning: null, fieldSources: { meaning: 'manual' } })
    expect(pickNeedInfo([todo, hasInfo, triedButEmpty, onlyPhonetic, manual])).toEqual([todo, triedButEmpty])
  })

  it('lookupChunks 每 30 个一批', () => {
    const base = filler(31)
    const parts = lookupChunks(base)
    expect(parts.map((p) => p.length)).toEqual([30, 1])
    expect(lookupChunks([])).toEqual([])
  })

  it('confusableChunks：batchSize=0 一次全带，>0 按设置分批', () => {
    const base = filler(5).map((it) => ({ ...it, meaning: '义' }))
    expect(confusableChunks(base, 0).map((p) => p.length)).toEqual([5])
    expect(confusableChunks(base, 2).map((p) => p.length)).toEqual([2, 2, 1])
    expect(pickConfusable(base)).toHaveLength(5)
    expect(pickConfusable([{ ...base[0], confusables: [] }, { ...base[1], confusables: [{ word: 'x' }] }])).toHaveLength(1)
  })

  it('pickExamples：离线例句不算数，已有 AI 例句就不再排', () => {
    const offline = vocabItem({ meaning: '义', examples: [{ text: 'a sentence', origin: 'tatoeba' }] })
    const withAi = vocabItem({ meaning: '义', examples: [{ text: 'a sentence', origin: 'ai' }] })
    expect(pickExamples([offline, withAi])).toEqual([offline])
  })

  it('pickPhrases 只看字段有没有（空数组也算标注过）', () => {
    const never = vocabItem({ meaning: '义' })
    const marked = vocabItem({ meaning: '义', phrases: [] })
    expect(pickPhrases([never, marked])).toEqual([never])
  })

  it('例句 / 词组 / 语法标记都按 30 个分批：一次点击排完所有缺口', () => {
    // 以前是 `.slice(0, 30)`：缺口 90 个要连点三次，用户看到的就是「点十次还在补」
    const base = filler(35).map((it) => ({ ...it, meaning: '义', partOfSpeech: 'n.' }))
    expect(exampleChunks(base).map((p) => p.length)).toEqual([30, 5])
    expect(phraseChunks(base).map((p) => p.length)).toEqual([30, 5])
    expect(markChunks(base).map((p) => p.length)).toEqual([30, 5])
    expect(exampleChunks([])).toEqual([])
  })

  it('pickContextLookup 只挑本篇语境还没释义的词', () => {
    const ctx = (fileName: string, meaning?: string) => ({
      articleId: fileName,
      fileName,
      sentenceId: 's1',
      sentenceText: 's',
      meaning,
      at: '2026-10-02T00:00:00.000Z',
    })
    const hit = vocabItem({ meaning: '义', contexts: [ctx('art')] })
    const other = vocabItem({ meaning: '义', contexts: [ctx('other')] })
    const done = vocabItem({ meaning: '义', contexts: [ctx('art', '已译')] })
    expect(pickContextLookup([hit, other, done], 'art')).toEqual([hit])
  })

  it('pickLemmas / pickPos 认非原型，辨析过的不再排', () => {
    const running = vocabItem({ word: 'running', lemma: 'run', note: '' })
    const done = vocabItem({ word: 'running', lemma: 'run', note: '已辨析：分词' })
    expect(pickLemmas([running, done])).toEqual([running, done]) // 原形校正不看 note
    expect(pickPos([running, done])).toEqual([running])
  })

  it('pickMarks 只看 grammarMarks 是否存在，空数组也算标注过', () => {
    const todo = vocabItem({ meaning: '义', partOfSpeech: 'n.', grammarMarks: undefined })
    const marked = vocabItem({ meaning: '义', partOfSpeech: 'n.', grammarMarks: [] })
    const notMarkable = vocabItem({ meaning: '义', partOfSpeech: 'prep.', grammarMarks: undefined })
    expect(pickMarks([todo, marked, notMarkable])).toEqual([todo])
  })

  it('chunk：size<=0 不切，空数组返回空', () => {
    expect(chunk([1, 2, 3], 0)).toEqual([[1, 2, 3]])
    expect(chunk([], 0)).toEqual([])
    expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]])
    expect(sentenceChunks(Array.from({ length: 7 }, (_, i) => i)).map((p) => p.length)).toEqual([6, 1])
  })

  it('article 范围只影响 pickTodoBase，其余筛选器都吃它的输出', () => {
    const inArticle = article({ status: 'unqueried', phonetic: null, meaning: null })
    const base = pickTodoBase({ scope: 'article', articleWords: [inArticle], items: filler(5) })
    expect(base).toEqual([inArticle])
    expect(lookupChunks(base)).toEqual([[inArticle]])
  })
})
