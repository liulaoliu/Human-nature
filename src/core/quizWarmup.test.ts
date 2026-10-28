import { describe, expect, it } from 'vitest'
import { defaultReviewState, type VocabItem } from '../types/document'
import type { QuizQuestion } from './quiz'
import { buildWarmupCards } from './quizWarmup'

function item(over: Partial<VocabItem> = {}): VocabItem {
  return {
    id: 'v1',
    word: 'run',
    lemma: 'run',
    phonetic: '/rʌn/',
    partOfSpeech: 'v.',
    meaning: '跑',
    usage: ['run a business'],
    examples: [{ text: '', translation: '' }, { text: 'I run every day.', translation: '我每天跑。' }],
    source: { articleId: 'a1', fileName: null, sentenceId: null, sentenceText: '' },
    status: 'queried',
    note: '',
    tags: [],
    reviewState: defaultReviewState(),
    createdAt: '2026-10-28T00:00:00.000Z',
    updatedAt: '2026-10-28T00:00:00.000Z',
    ...over,
  }
}

function question(itemId: string): QuizQuestion {
  return {
    id: `q-${itemId}`,
    itemId,
    lemma: 'run',
    kind: 'meaning',
    word: 'run',
    prompt: '跑',
    meaning: '跑',
    partOfSpeech: 'v.',
    phonetic: null,
    answer: 'run',
    accept: ['run'],
  }
}

describe('buildWarmupCards', () => {
  it('按题目顺序去重，只取存在的词条', () => {
    const cards = buildWarmupCards([item(), item({ id: 'v2', word: 'walk', lemma: 'walk' })], [
      question('v1'),
      question('v1'),
      question('missing'),
      question('v2'),
    ], 'memory')
    expect(cards.map((c) => c.id)).toEqual(['v1', 'v2'])
  })

  it('记忆拷打带第一条非空例句；词块拷打带词块且最多 6 条', () => {
    const memory = buildWarmupCards([item()], [question('v1')], 'memory')
    expect(memory[0].example).toBe('I run every day.')
    expect(memory[0].chunks).toEqual([])

    const chunk = buildWarmupCards([
      item({
        phrases: ['run out', 'run into', 'run over'],
        idioms: ['in the long run', 'run a business'],
        usage: ['run errands', 'run late'],
      }),
    ], [question('v1')], 'chunk')
    expect(chunk[0].chunks).toHaveLength(6)
    expect(chunk[0].chunks[0]).toBe('run out')
    expect(chunk[0].example).toBeUndefined()
  })

  it('空词库不炸，缺字段按空处理', () => {
    expect(buildWarmupCards([], [question('v1')], 'chunk')).toEqual([])
    const bare = item({ phonetic: undefined, meaning: undefined, examples: [] })
    const cards = buildWarmupCards([bare], [question('v1')], 'memory')
    expect(cards[0].phonetic).toBeUndefined()
    expect(cards[0].meaning).toBeUndefined()
    expect(cards[0].example).toBeUndefined()
  })
})
