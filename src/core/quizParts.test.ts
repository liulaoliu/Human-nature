import { describe, it, expect } from 'vitest'
import {
  blankParticle,
  blankWord,
  chunkList,
  formatAnswerInput,
  markQuestion,
  maskAnswer,
  normalizeAnswer,
  pickDistractors,
  pickMeaningDistractors,
  shuffleQuiz,
} from './quizParts'
import type { VocabItem } from '../types/document'

/**
 * 出题素材（从 quiz.ts 抽出的无状态纯函数）。
 * 只测「素材本身怎么变」；出题流程与判分在 quiz.test.ts。
 */

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

describe('答案归一化与形状提示', () => {
  it('normalizeAnswer：忽略大小写 / 首尾标点 / 多余空白', () => {
    expect(normalizeAnswer('  Running, ')).toBe('running')
    expect(normalizeAnswer('a  business.')).toBe('a business')
  })

  it('maskAnswer：只暗示长度，不泄露字母', () => {
    expect(maskAnswer('bad-temperedly')).toBe('___-' + '_'.repeat(10))
    expect(maskAnswer('run a business')).toBe('___ _ ' + '_'.repeat(8))
  })

  it('formatAnswerInput：按答案补连字符 / 撇号', () => {
    expect(formatAnswerInput('badt', 'bad-temperedly')).toBe('bad-t')
    expect(formatAnswerInput('dont', "don't")).toBe("don't")
    // 拼的不是答案前缀就不动
    expect(formatAnswerInput('xyz', 'bad-temperedly')).toBe('xyz')
  })
})

describe('挖空', () => {
  it('blankWord：按 lemma 匹配词形并挖空', () => {
    const r = blankWord('He is running fast.', 'run')
    expect(r?.blanked).toBe('He is ____ fast.')
    expect(r?.surface).toBe('running')
  })

  it('blankWord：短语整段匹配；找不到返回 null', () => {
    expect(blankWord('The human rights record is poor.', 'human rights')?.blanked).toBe(
      'The ____ record is poor.',
    )
    expect(blankWord('Nothing here.', 'run')).toBeNull()
  })

  it('blankParticle：挖掉搭配里最后一个介词', () => {
    expect(blankParticle('run out of')).toEqual({ blanked: 'run out ____', particle: 'of' })
    expect(blankParticle('run fast')).toBeNull()
  })
})

describe('干扰项', () => {
  it('pickDistractors：优先用 AI 易混词，并跳过与目标近义的', () => {
    const it = item({
      word: 'adapt',
      meaning: '适应',
      confusables: [
        { word: 'adopt', meaning: '采用' },
        { word: 'adaptable', meaning: '适应的' }, // 与目标释义重叠 → 跳过
        { word: 'adept', meaning: '熟练的' },
      ],
    })
    expect(pickDistractors(it, [], 2, () => 0)).toEqual(['adopt', 'adept'])
  })

  it('pickMeaningDistractors：优先用 AI 易混释义，去重且不近义', () => {
    const it = item({
      word: 'adapt',
      meaning: '适应',
      confusables: [
        { word: 'adopt', meaning: '采用' },
        { word: 'adept', meaning: '熟练的' },
        { word: 'adaptable', meaning: '适应的' },
      ],
    })
    expect(pickMeaningDistractors(it, [], 2, () => 0)).toEqual(['采用', '熟练的'])
  })
})

describe('词块与语法标记', () => {
  it('chunkList：用法 + 词组，去空 / 去重 / 去掉词本身', () => {
    const it = item({
      word: 'run',
      usage: ['run out of', 'Run out of', 'run'],
      phrases: ['run into', '  '],
    })
    expect(chunkList(it)).toEqual(['run out of', 'run into'])
  })

  it('markQuestion：单一语法标记出一对选项；兼类返回 null', () => {
    expect(markQuestion(item({ grammarMarks: ['可数'] }))).toEqual({
      label: '这个名词（此义）可数吗？',
      answer: '可数',
      options: ['可数', '不可数'],
    })
    expect(markQuestion(item({ grammarMarks: ['可数', '不可数'] }))).toBeNull()
    expect(markQuestion(item())).toBeNull()
  })
})

describe('shuffleQuiz', () => {
  it('洗牌不丢项，且随机源确定时结果确定', () => {
    const src = [1, 2, 3, 4]
    const a = shuffleQuiz(src, () => 0)
    expect(a).toEqual([2, 3, 4, 1])
    expect(shuffleQuiz(src, () => 0)).toEqual(a)
    expect([...a].sort()).toEqual([1, 2, 3, 4])
    expect(src).toEqual([1, 2, 3, 4]) // 不改原数组
  })
})
