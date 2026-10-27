import { describe, expect, it } from 'vitest'
import {
  buildLocalGoldenLesson,
  buildLocalGoldenSentence,
  buildLocalTargets,
  goldenTargetLimit,
  goldenTargetsFor,
  findGoldenTargetSpans,
  normalizeGoldenTargets,
  pickGoldenCandidates,
} from './golden'
import type { Sentence } from '../types/document'

const S = (id: string, text: string, extra: Partial<Sentence> = {}): Sentence => ({
  id,
  paraId: 'p01',
  text,
  audio: null,
  translation: null,
  grammarNote: null,
  collocations: [],
  vocab: [],
  tags: [],
  reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
  ...extra,
})

const TARGET = { en: 'in response to', zh: '为了应对', kind: 'collocation' as const }

describe('golden target matching', () => {
  it('只匹配完整词，不允许命中词的一部分', () => {
    expect(findGoldenTargetSpans('The new norm is normal.', 'norm')).toHaveLength(1)
    expect(findGoldenTargetSpans('The new norm is normal.', 'nor')).toHaveLength(0)
  })

  it('容忍大小写、撇号和连字符变体', () => {
    expect(findGoldenTargetSpans("Don't stop.", "don’t")).toHaveLength(1)
    expect(findGoldenTargetSpans('A bad-tempered man.', 'bad‑tempered')).toHaveLength(0)
    expect(findGoldenTargetSpans('A bad-tempered man.', 'bad–tempered')).toHaveLength(1)
  })

  it('目标上限按句长变化：短句少、长句最多 20', () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')
    expect(goldenTargetLimit('one two three')).toBe(6)
    expect(goldenTargetLimit(words(10))).toBe(10)
    expect(goldenTargetLimit(words(25))).toBe(20)
    const raw = Array.from({ length: 25 }, (_, i) => ({ en: `word${i}`, kind: 'word' as const }))
    expect(normalizeGoldenTargets(words(25), raw)).toHaveLength(20)
  })

  it('重叠时长的优先，输出仍按原句顺序', () => {
    const text = 'The committee will examine the draft.'
    const out = normalizeGoldenTargets(text, [
      { en: 'will examine', kind: 'tense' },
      { en: 'examine the draft', kind: 'collocation' },
    ])
    expect(out.map((t) => t.en)).toEqual(['examine the draft'])
  })

  it('清洗目标：丢掉编造/重复/重叠，保留长目标', () => {
    const text = 'In response to the pandemic, remote collaboration has become the new norm.'
    const out = normalizeGoldenTargets(text, [
      TARGET,
      { en: 'response', kind: 'word' },
      { en: 'remote collaboration', kind: 'collocation' },
      { en: 'in response to', kind: 'collocation' },
      { en: 'not in the sentence', kind: 'word' },
    ])
    expect(out.map((t) => t.en)).toEqual(['in response to', 'remote collaboration'])
  })

  it('本地目标不再卡 6 个；所有不重叠的语言点都保留', () => {
    const s = S('s1', 'The committee examines the draft, the board considers the budget, and the staff publishes the report tomorrow.', {
      language: {
        phrases: ['examines the draft', 'considers the budget', 'publishes the report'],
        usage: ['正式场合用 committee', 'report 可数'],
      },
      vocab: ['committee', 'board', 'staff', 'tomorrow'],
    })
    const out = buildLocalTargets(s)
    expect(out.map((t) => t.en)).toEqual(expect.arrayContaining([
      'examines the draft',
      'considers the budget',
      'publishes the report',
      'committee',
      'board',
      'staff',
      'tomorrow',
    ]))
    expect(out.length).toBeGreaterThan(6)
    expect(buildLocalGoldenSentence(s).note).toContain('正式场合用 committee')
    expect(buildLocalGoldenSentence(s).note).toContain('report 可数')
  })

  it('本地目标：语言点词组/习语优先，保守抽时态', () => {
    const s = S('s1', 'In response to the pandemic, remote collaboration has become the new norm.', {
      translation: '为了应对疫情，远程协作已经成为新常态。',
      language: {
        structure: 'In response to + n., … has become …',
        grammar: '现在完成时 has become',
        phrases: ['in response to — 为了应对'],
        idioms: ['the new norm — 新常态'],
      },
    })
    const out = buildLocalTargets(s)
    expect(out.map((t) => t.en)).toContain('in response to')
    expect(out.map((t) => t.en)).toContain('the new norm')
    expect(out.map((t) => t.en)).toContain('has become')
  })
})

describe('golden lesson', () => {
  const sentences = [
    S('s1', 'In response to the pandemic, remote collaboration has become the new norm.', {
      translation: '为了应对疫情，远程协作已经成为新常态。',
      language: { phrases: ['in response to — 为了应对'], grammar: '现在完成时' },
    }),
    S('s2', 'Team spirit is one of the main factors that contribute to success.', {
      translation: '团队精神是促成成功的主要因素之一。',
      language: { phrases: ['team spirit — 团队精神'], idioms: ['one of the main factors'] },
    }),
    S('s3', 'Short.', { translation: '短。' }),
  ]

  it('推荐金句优先语言点，并保持原文顺序', () => {
    const picked = pickGoldenCandidates(sentences, 2)
    expect(picked.map((x) => x.id).sort()).toEqual(['s1', 's2'])
  })

  it('本地课程：开头/主体/结尾脉络 + 默认 10 句上限', () => {
    const lesson = buildLocalGoldenLesson(
      Array.from({ length: 12 }, (_, i) => S(`s${i + 1}`, `This is sentence number ${i + 1} with enough words.`)),
      [
        { id: 'p01', sentenceIds: ['s1', 's2'] },
        { id: 'p02', sentenceIds: ['s3', 's4'] },
        { id: 'p03', sentenceIds: ['s5'] },
      ],
    )
    expect(lesson.sentences.length).toBeLessThanOrEqual(10)
    expect(lesson.outline.map((x) => x.role)).toEqual(['intro', 'body', 'conclusion'])
  })

  it('本课去重只影响取目标，不改课程内容（开关可关）', () => {
    const lesson = buildLocalGoldenLesson(
      [S('s1', 'Team spirit matters.', { language: { phrases: ['team spirit'] } }), S('s2', 'Team spirit wins.', { language: { phrases: ['team spirit'] } })],
      undefined,
      { selected: ['s1', 's2'], dedupe: true },
    )
    expect(lesson.sentences[0].targets.map((t) => t.en)).toEqual(['team spirit'])
    expect(lesson.sentences[1].targets.map((t) => t.en)).toEqual(['team spirit'])
    expect(goldenTargetsFor(lesson, 's1').map((t) => t.en)).toEqual(['team spirit'])
    expect(goldenTargetsFor(lesson, 's2')).toEqual([])
    expect(goldenTargetsFor({ ...lesson, options: { dedupe: false } }, 's2').map((t) => t.en)).toEqual(['team spirit'])
  })
})


