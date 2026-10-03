import { describe, it, expect } from 'vitest'
import {
  blankWord,
  buildQuizQuestions,
  formatAnswerInput,
  isCorrect,
  makeDictationQuestion,
  makeQuestion,
  maskAnswer,
  normalizeAnswer,
  pickDistractors,
  pickMeaningDistractors,
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
  it('听音拼词：隐藏文字、读单词、答案为原词', () => {
    const q = makeQuestion(item({ word: 'slide', lemma: 'slide' }), 'ear')!
    expect(q.prompt).toBe('')
    expect(q.meaning).toBeNull()
    expect(q.audioText).toBe('slide')
    expect(q.answer).toBe('slide')
  })
  it('词形辨析：给释义、选项含正确答案与干扰项', () => {
    const pool = [
      item({ id: 'a', word: 'adapt', lemma: 'adapt', meaning: '适应' }),
      item({ id: 'b', word: 'adopt', lemma: 'adopt', meaning: '采用' }),
      item({ id: 'c', word: 'adept', lemma: 'adept', meaning: '熟练的' }),
      item({ id: 'd', word: 'zebra', lemma: 'zebra', meaning: '斑马' }),
    ]
    const q = makeQuestion(pool[0], 'choice', pool)!
    expect(q.prompt).toBe('适应')
    expect(q.options).toContain('adapt')
    expect(q.options!.length).toBeGreaterThanOrEqual(2)
  })
  it('词形辨析：没有干扰项则为 null', () => {
    expect(makeQuestion(item({ meaning: '适应' }), 'choice', [])).toBeNull()
  })
  it('看词选义：题干是英文、选项是中文释义', () => {
    const pool = [
      item({ id: 'a', word: 'adapt', lemma: 'adapt', meaning: '适应' }),
      item({ id: 'b', word: 'adopt', lemma: 'adopt', meaning: '采用' }),
      item({ id: 'c', word: 'adept', lemma: 'adept', meaning: '熟练的' }),
    ]
    const q = makeQuestion(pool[0], 'meaning', pool)!
    expect(q.prompt).toBe('adapt')
    expect(q.answer).toBe('适应')
    expect(q.options).toContain('适应')
    expect(q.options!.length).toBeGreaterThanOrEqual(2)
    expect(isCorrect(q, '适应')).toBe(true)
    expect(isCorrect(q, '采用')).toBe(false)
  })
  it('看词选义：没有释义则为 null', () => {
    expect(makeQuestion(item({ meaning: null }), 'meaning', [item({ id: 'b', meaning: 'x' })])).toBeNull()
  })
})

describe('pickMeaningDistractors', () => {
  it('排除同释义、去重', () => {
    const pool = [
      item({ id: 'a', meaning: '适应' }),
      item({ id: 'b', meaning: '采用' }),
      item({ id: 'c', meaning: '采用' }),
      item({ id: 'd', meaning: '斑马' }),
    ]
    const out = pickMeaningDistractors(pool[0], pool, 3, () => 0.5)
    expect(out).not.toContain('适应')
    expect(new Set(out).size).toBe(out.length)
    expect(out).toContain('采用')
  })
  it('优先用 AI 混淆项的释义', () => {
    const me = item({ id: 'a', meaning: '适应', confusables: [{ word: 'adopt', meaning: '采用' }, { word: 'adept', meaning: '熟练的' }] })
    const out = pickMeaningDistractors(me, [], 3, () => 0.5)
    expect(out.slice(0, 2)).toEqual(['采用', '熟练的'])
  })
  it('近义 / 包含关系的释义会被剔除', () => {
    const me = item({
      id: 'a',
      meaning: '调整',
      confusables: [
        { word: 'x', meaning: '微调，调整' },
        { word: 'y', meaning: '采纳' },
      ],
    })
    const out = pickMeaningDistractors(me, [], 3, () => 0.5)
    expect(out).toEqual(['采纳'])
  })
})

describe('maskAnswer', () => {
  it('字母变下划线，保留空格 / 连字符 / 撇号', () => {
    expect(maskAnswer('run')).toBe('___')
    expect(maskAnswer('bad-temperedly')).toBe('___-' + '_'.repeat(10))
    expect(maskAnswer('run a business')).toBe('___ _ ' + '_'.repeat(8))
    expect(maskAnswer("don't")).toBe("___'_")
  })
})

describe('pickDistractors', () => {
  it('排除自身、优先形近', () => {
    const pool = [
      item({ id: 'a', word: 'adapt', lemma: 'adapt' }),
      item({ id: 'b', word: 'adopt', lemma: 'adopt' }),
      item({ id: 'c', word: 'adept', lemma: 'adept' }),
      item({ id: 'd', word: 'zebra', lemma: 'zebra' }),
    ]
    const out = pickDistractors(pool[0], pool, 2, () => 0.5)
    expect(out).not.toContain('adapt')
    expect(out).toContain('adopt')
  })
  it('优先用 AI 混淆项', () => {
    const me = item({ id: 'a', word: 'adapt', lemma: 'adapt', confusables: [{ word: 'adopt' }, { word: 'adept' }] })
    const out = pickDistractors(me, [], 3, () => 0.5)
    expect(out.slice(0, 2)).toEqual(['adopt', 'adept'])
  })
  it('与目标近义的易混词会被剔除', () => {
    const me = item({
      id: 'a',
      word: 'adapt',
      lemma: 'adapt',
      meaning: '适应',
      confusables: [
        { word: 'adjust', meaning: '适应' },
        { word: 'adopt', meaning: '收养' },
      ],
    })
    const out = pickDistractors(me, [], 3, () => 0.5)
    expect(out).toEqual(['adopt'])
  })
})

describe('makeDictationQuestion', () => {
  it('按给定句子挖空目标词', () => {
    const it = item({ word: 'run', lemma: 'run', meaning: '跑' })
    const q = makeDictationQuestion(it, 'She runs daily.')!
    expect(q.kind).toBe('listen')
    expect(q.audioText).toBe('She runs daily.')
    expect(q.answer).toBe('runs')
  })
  it('句子里没有该词则为 null', () => {
    expect(makeDictationQuestion(item(), 'Nothing here.')).toBeNull()
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
