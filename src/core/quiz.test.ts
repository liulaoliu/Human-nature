import { describe, it, expect } from 'vitest'
import {
  blankWord,
  buildQuizQuestions,
  formatAnswerInput,
  isCorrect,
  makeQuestion,
  normalizeAnswer,
  shuffleQuiz,
  type QuizQuestion,
} from './quiz'
import type { VocabItem } from '../types/document'

const NOW = '2026-10-02T00:00:00.000Z'

function item(over: Partial<VocabItem> = {}): VocabItem {
  return {
    id: 'vocab:run',
    word: 'run',
    lemma: 'run',
    phonetic: '/rʌn/',
    partOfSpeech: 'v.',
    meaning: '跑；经营',
    usage: [],
    examples: [],
    source: null,
    status: 'queried',
    note: '',
    tags: [],
    reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

describe('normalizeAnswer', () => {
  it('大小写 / 首尾标点 / 空白', () => {
    expect(normalizeAnswer('  Running, ')).toBe('running')
    expect(normalizeAnswer('a  business.')).toBe('a business')
  })
})

describe('blankWord', () => {
  it('按 lemma 匹配词形并挖空', () => {
    const r = blankWord('He is running fast.', 'run')
    expect(r?.blanked).toBe('He is ____ fast.')
    expect(r?.surface).toBe('running')
  })
  it('短语整段匹配', () => {
    const r = blankWord('The human rights record is poor.', 'human rights')
    expect(r?.blanked).toBe('The ____ record is poor.')
    expect(r?.surface).toBe('human rights')
  })
  it('找不到返回 null', () => {
    expect(blankWord('nothing here', 'run')).toBeNull()
  })
})

describe('makeQuestion', () => {
  it('拼写：需要释义', () => {
    expect(makeQuestion(item(), 'spell')?.prompt).toBe('跑；经营')
    expect(makeQuestion(item({ meaning: null }), 'spell')).toBeNull()
  })
  it('例句填空：从例句挖空', () => {
    const it = item({ examples: [{ text: 'They run a business together.', translation: '他们一起经营生意。' }] })
    const q = makeQuestion(it, 'cloze')!
    expect(q.prompt).toBe('They ____ a business together.')
    expect(q.answer).toBe('run')
    expect(q.translation).toBe('他们一起经营生意。')
  })
  it('例句填空：例句没命中就退回来源句', () => {
    const it = item({
      examples: [{ text: 'No target here.' }],
      source: { articleId: 'a1', fileName: null, sentenceId: 's1', sentenceText: 'She runs daily.' },
    })
    expect(makeQuestion(it, 'cloze')?.prompt).toBe('She ____ daily.')
  })
  it('搭配填空：从 usage 挖空', () => {
    const it = item({ usage: ['run a business', 'run out'] })
    const q = makeQuestion(it, 'usage')!
    expect(q.prompt).toBe('____ a business')
    expect(q.answer).toBe('run')
  })
  it('搭配填空：usage 不含该词则为 null', () => {
    expect(makeQuestion(item({ usage: ['a business'] }), 'usage')).toBeNull()
  })
  it('听力填空：隐藏句子、带朗读文本', () => {
    const it = item({ examples: [{ text: 'They run a business together.', translation: '他们一起经营生意。' }] })
    const q = makeQuestion(it, 'listen')!
    expect(q.prompt).toBe('')
    expect(q.audioText).toBe('They run a business together.')
    expect(q.context).toBe('They run a business together.')
    expect(q.answer).toBe('run')
  })
  it('听力填空：没有句子则为 null', () => {
    expect(makeQuestion(item({ examples: [], source: null }), 'listen')).toBeNull()
  })
})

describe('buildQuizQuestions', () => {
  it('按选题型出题，每种题型最多一题', () => {
    const it = item({
      usage: ['run a business'],
      examples: [{ text: 'They run fast.' }],
    })
    const qs = buildQuizQuestions([it], ['spell', 'cloze', 'usage'])
    expect(qs.map((q) => q.kind)).toEqual(['spell', 'cloze', 'usage'])
  })
  it('数据不足的题型会跳过', () => {
    const it = item({ meaning: '跑', usage: [], examples: [], source: null })
    const qs = buildQuizQuestions([it], ['spell', 'cloze', 'usage'])
    expect(qs.map((q) => q.kind)).toEqual(['spell'])
  })
  it('题 id 唯一', () => {
    const a = item({ id: 'a', lemma: 'run', word: 'run', examples: [{ text: 'run fast' }] })
    const b = item({ id: 'b', lemma: 'go', word: 'go', examples: [{ text: 'go fast' }] })
    const qs = buildQuizQuestions([a, b], ['cloze'])
    expect(new Set(qs.map((q) => q.id)).size).toBe(qs.length)
  })
})

describe('isCorrect', () => {
  const q: QuizQuestion = {
    id: 'x',
    itemId: 'x',
    lemma: 'run',
    kind: 'cloze',
    word: 'run',
    prompt: 'They ____ fast.',
    meaning: '跑',
    partOfSpeech: null,
    phonetic: null,
    answer: 'running',
    accept: ['running', 'run'],
  }
  it('精确 / 大小写 / 标点都对', () => {
    expect(isCorrect(q, 'running')).toBe(true)
    expect(isCorrect(q, ' Running. ')).toBe(true)
    expect(isCorrect(q, 'run')).toBe(true)
  })
  it('词形还原一致也算对', () => {
    expect(isCorrect(q, 'runs')).toBe(true)
  })
  it('错误答案判错 / 空答判错', () => {
    expect(isCorrect(q, 'walk')).toBe(false)
    expect(isCorrect(q, '   ')).toBe(false)
  })
})

describe('shuffleQuiz', () => {
  it('不改原数组，元素不丢', () => {
    const src = [1, 2, 3, 4, 5]
    const out = shuffleQuiz(src, () => 0.5)
    expect(src).toEqual([1, 2, 3, 4, 5])
    expect(out.sort()).toEqual([1, 2, 3, 4, 5])
  })
})

describe('连字符 / 撇号宽容', () => {
  const q: QuizQuestion = {
    id: 'x',
    itemId: 'x',
    lemma: 'bad-temperedly',
    kind: 'spell',
    word: 'bad-temperedly',
    prompt: '脾气坏地',
    meaning: '脾气坏地',
    partOfSpeech: null,
    phonetic: null,
    answer: 'bad-temperedly',
    accept: ['bad-temperedly'],
  }
  it('不打连字符也判对', () => {
    expect(isCorrect(q, 'badtemperedly')).toBe(true)
    expect(isCorrect(q, 'bad temperedly')).toBe(true)
    expect(isCorrect(q, 'bad-temperedly')).toBe(true)
    expect(isCorrect(q, 'bad')).toBe(false)
  })
  it('formatAnswerInput 自动补连字符 / 撇号', () => {
    expect(formatAnswerInput('bad', 'bad-temperedly')).toBe('bad')
    expect(formatAnswerInput('badt', 'bad-temperedly')).toBe('bad-t')
    expect(formatAnswerInput('badtemp', 'bad-temperedly')).toBe('bad-temp')
    expect(formatAnswerInput('badtemperedly', 'bad-temperedly')).toBe('bad-temperedly')
    expect(formatAnswerInput("dont", "don't")).toBe("don't")
    expect(formatAnswerInput('xyz', 'bad-temperedly')).toBe('xyz')
    expect(formatAnswerInput('', 'bad-temperedly')).toBe('')
  })
})
