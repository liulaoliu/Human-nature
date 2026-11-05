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

describe('createQuizCheck：答题后朗读', () => {
  it('语法标记不朗读选中的「可数 / 不可数」——选项标签不是学习内容', () => {
    const p = params({
      queue: [{ ...articleQuestion, id: 'a1:mark', kind: 'mark', prompt: 'letter 可数吗？', answer: '可数', accept: ['可数'] }],
      speakAfter: true,
    })
    createQuizCheck(p)('可数')
    expect(p.speak).not.toHaveBeenCalled()
  })

  it('其它题型仍按原规则朗读（看词选义读单词）', () => {
    const p = params({
      queue: [{ ...articleQuestion, id: 'a1:meaning', kind: 'meaning', word: 'run', answer: '跑', accept: ['跑'] }],
      speakAfter: true,
    })
    createQuizCheck(p)('跑')
    expect(p.speak).toHaveBeenCalledWith('run')
  })
})

describe('createQuizCheck：答过的题记入本轮历史', () => {
  it('判分后通知 onAnswered，交给下一轮去重', () => {
    const onAnswered = vi.fn()
    const p = params({ onAnswered })
    createQuizCheck(p)('我每天跑步。')
    expect(onAnswered).toHaveBeenCalledWith(articleQuestion)
  })
})

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
