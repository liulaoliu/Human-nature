import { describe, expect, it } from 'vitest'
import { createLibrary } from '../vocab'
import { vocabItem } from '../testFixtures'
import { compactSentenceTexts, hydrateSentenceTexts, sentenceTextKey } from './sentenceTexts'

const SENTENCE = 'The bank raised its rate.'
const source = (text = SENTENCE) => ({
  articleId: 'art-1',
  fileName: null,
  sentenceId: 's1',
  sentenceText: text,
})

function libraryWithDuplicates() {
  return {
    ...createLibrary(),
    items: [
      vocabItem({ id: 'a', lemma: 'bank', source: source() }),
      vocabItem({
        id: 'b',
        lemma: 'rate',
        source: source(),
        contexts: [{ articleId: 'art-1', fileName: null, sentenceId: 's1', sentenceText: SENTENCE, at: '2026-10-24T00:00:00.000Z' }],
      }),
    ],
    articleEntries: [
      { articleId: 'art-1', lemma: 'bank', origin: 'manual' as const, addedAt: '2026-10-24T00:00:00.000Z', sentenceId: 's1', sentenceText: SENTENCE },
    ],
  }
}

describe('sentenceTexts：同一句只存一份', () => {
  it('compact 把 source / contexts / articleEntries 的原文收进共享表', () => {
    const lib = libraryWithDuplicates()
    const key = sentenceTextKey({ articleId: 'art-1', sentenceId: 's1' })
    const next = compactSentenceTexts(lib)

    expect(next.sentenceTexts).toEqual({ [key]: SENTENCE })
    expect(next.items[0].source?.sentenceText).toBe('')
    expect(next.items[1].source?.sentenceText).toBe('')
    expect(next.items[1].contexts?.[0].sentenceText).toBe('')
    expect(next.articleEntries?.[0].sentenceText).toBe('')
  })

  it('hydrate 再把原文补回所有引用', () => {
    const back = hydrateSentenceTexts(compactSentenceTexts(libraryWithDuplicates()))
    expect(back.items[0].source?.sentenceText).toBe(SENTENCE)
    expect(back.items[1].contexts?.[0].sentenceText).toBe(SENTENCE)
    expect(back.articleEntries?.[0].sentenceText).toBe(SENTENCE)
  })

  it('compact 幂等：第二次不会越压越少', () => {
    const once = compactSentenceTexts(libraryWithDuplicates())
    const twice = compactSentenceTexts(once)
    expect(twice).toEqual(once)
  })

  it('同一句 id 文本不一致（比如改过正文）→ 不共享，保留各自原文', () => {
    const lib = libraryWithDuplicates()
    lib.items[1].source = source('The bank raised its rates.')
    const next = compactSentenceTexts(lib)

    expect(next.sentenceTexts).toBeUndefined()
    expect(next.items[0].source?.sentenceText).toBe(SENTENCE)
    expect(next.items[1].source?.sentenceText).toBe('The bank raised its rates.')
  })

  it('没有 sentenceId 的引用不参与共享', () => {
    const lib = {
      ...createLibrary(),
      items: [vocabItem({ id: 'a', lemma: 'bank', source: { articleId: 'art-1', fileName: null, sentenceId: null, sentenceText: SENTENCE } })],
    }
    const next = compactSentenceTexts(lib)
    expect(next.sentenceTexts).toBeUndefined()
    expect(next.items[0].source?.sentenceText).toBe(SENTENCE)
  })

  it('旧数据只有共享表、引用里没有原文 → hydrate 能补回来', () => {
    const key = sentenceTextKey({ articleId: 'art-1', sentenceId: 's1' })
    const lib = {
      ...createLibrary(),
      items: [
        vocabItem({
          id: 'a',
          lemma: 'bank',
          source: { articleId: 'art-1', fileName: null, sentenceId: 's1', sentenceText: '' },
        }),
      ],
      sentenceTexts: { [key]: SENTENCE },
    }
    expect(hydrateSentenceTexts(lib).items[0].source?.sentenceText).toBe(SENTENCE)
  })
})
