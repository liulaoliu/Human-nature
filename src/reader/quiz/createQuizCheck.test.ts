import { describe, expect, it, vi } from 'vitest'
import { createLibrary } from '../../core/vocab'
import type { QuizQuestion } from '../../core/quiz'
import { createQuizCheck, type QuizCheckParams } from './createQuizCheck'

const articleQuestion: QuizQuestion = {
  id: 'a1:translate',
  itemId: 'a1',
  lemma: 'run',
  kind: 'translate',
  source: 'article',
  word: 'run',
  prompt: 'I run daily.',
  meaning: null,
  partOfSpeech: null,
  phonetic: null,
  answer: '我每天跑步。',
  accept: ['我每天跑步。'],
}

function params(over: Partial<QuizCheckParams> = {}): QuizCheckParams {
  return {
    queue: [articleQuestion],
    index: 0,
    checked: false,
    input: '',
    library: createLibrary(),
    articleIdentity: 'A',
    autoRun: false,
    speakAfter: false,
    persist: vi.fn(),
    markStudied: vi.fn(),
    recordActivity: vi.fn(),
    recordAnswer: vi.fn(),
    addMistake: vi.fn(),
    dropMistake: vi.fn(),
    speak: vi.fn(),
    scheduleAdvance: vi.fn(),
    setChecked: vi.fn(),
    setResult: vi.fn(),
    setResults: vi.fn(),
    setSpellMiss: vi.fn(),
    ...over,
  }
}

describe('createQuizCheck：文章题不写词级账本', () => {
  it('只记活动 / 答题事件，不写 SRS、错题本、已学', () => {
    const p = params()
    createQuizCheck(p)('我每天跑步。')

    expect(p.persist).not.toHaveBeenCalled()
    expect(p.markStudied).not.toHaveBeenCalled()
    expect(p.addMistake).not.toHaveBeenCalled()
    expect(p.dropMistake).not.toHaveBeenCalled()
    expect(p.recordActivity).toHaveBeenCalledWith('read', 1)
    expect(p.recordAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ articleId: 'A', source: 'quiz', kind: 'translate', cat: 'read', correct: true }),
    )
    expect(p.setChecked).toHaveBeenCalledWith(true)
    expect(p.setResult).toHaveBeenCalledWith(true)
  })
})
