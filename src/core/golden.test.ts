import { describe, expect, it } from 'vitest'
import {
  buildGoldenAssembly,
  buildGoldenCloze,
  buildLocalGoldenLesson,
  buildLocalTargets,
  checkGoldenAssembly,
  checkGoldenFill,
  checkGoldenRecall,
  goldenTargetsFor,
  mergeGoldenIntoArticle,
  findGoldenTargetSpans,
  goldenDrillKey,
  normalizeGoldenLesson,
  normalizeGoldenTargets,
  pickGoldenCandidates,
  pruneGoldenLesson,
} from './golden'
import type { GoldenLesson, Sentence } from '../types/document'

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

describe('golden cloze / assembly / recall', () => {
  const text = 'In response to the pandemic, remote collaboration has become the new norm.'
  const targets = [
    { en: 'in response to', zh: '为了应对', kind: 'collocation' as const },
    { en: 'remote collaboration', zh: '远程协作', kind: 'collocation' as const },
    { en: 'has become', zh: '已经成为', kind: 'tense' as const },
  ]

  it('多词块挖空；同一目标重复出现共用一个空', () => {
    const cloze = buildGoldenCloze('In response to this, in response to that.', [
      { en: 'in response to', kind: 'collocation' },
    ])
    expect(cloze?.blanks).toHaveLength(1)
    expect(cloze?.parts.filter((p) => p.blank)).toHaveLength(2)
  })

  it('填空判分忽略大小写/标点；拼句按顺序', () => {
    const cloze = buildGoldenCloze(text, targets)
    expect(cloze).not.toBeNull()
    if (!cloze) return
    expect(checkGoldenFill(cloze, ['In response to', 'remote collaboration', 'has become'])).toEqual([true, true, true])
    expect(checkGoldenFill(cloze, ['response to', 'remote collaboration', 'has become'])).toEqual([false, true, true])
    const bank = buildGoldenAssembly(text, targets)
    expect(bank).not.toBeNull()
    if (!bank) return
    expect(checkGoldenAssembly(bank.cloze.targets, bank.cloze.targets.map((t) => t.en))).toBe(true)
    expect(checkGoldenAssembly(bank.cloze.targets, ['has become', 'remote collaboration', 'in response to'])).toBe(false)
    expect(buildGoldenAssembly(text, targets)?.bank).toEqual(bank.bank)
  })

  it('逆向默写：exact/near 算首次正确，loose 不算', () => {
    expect(checkGoldenRecall(text, text).firstOk).toBe(true)
    expect(checkGoldenRecall('In response to the pandemic, remote collaboration has become the new norm', text).firstOk).toBe(true)
    expect(checkGoldenRecall('Remote work is popular now.', text).firstOk).toBe(false)
  })
})

describe('normalize / prune golden lesson', () => {
  const sentences = [
    { id: 's1', text: 'In response to the pandemic, remote collaboration has become the new norm.', translation: '为了应对疫情，远程协作已经成为新常态。' },
  ]
  const raw = {
    source: 'ai',
    summary: '核心',
    outline: [{ paraId: 'p01', role: 'intro', points: ['要点'] }],
    selected: ['s1', 's404'],
    sentences: [
      {
        id: 's1',
        pattern: 'In response to + n., … has become …',
        targets: [
          { en: 'in response to', zh: '为了应对', kind: 'collocation' },
          { en: 'made up', zh: '编造', kind: 'word' },
        ],
      },
      { id: 's404', targets: [] },
    ],
  }

  it('未知句子与编造目标被丢掉，保留有效内容', () => {
    const lesson = normalizeGoldenLesson(raw, sentences)
    expect(lesson).not.toBeNull()
    expect(lesson?.sentences).toHaveLength(1)
    expect(lesson?.sentences[0].targets.map((t) => t.en)).toEqual(['in response to'])
    expect(lesson?.sentences[0].zh).toBe('为了应对疫情，远程协作已经成为新常态。')
    expect(lesson?.selected).toEqual(['s1'])
  })

  it('改正文后内容对不上就作废', () => {
    const lesson = normalizeGoldenLesson(raw, sentences)
    expect(lesson).not.toBeNull()
    if (!lesson) return
    expect(pruneGoldenLesson(lesson, [{ id: 's1', text: 'Completely different.' }])).toBeUndefined()
  })

  it('drillKey 对文本/目标敏感', () => {
    const a = goldenDrillKey('abc', [{ en: 'a', kind: 'word' }])
    const b = goldenDrillKey('abc', [{ en: 'a', kind: 'word' }])
    const c = goldenDrillKey('abc', [{ en: 'b', kind: 'word' }])
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('导入旧备份没有 golden 时保留现有金句课', () => {
    const lesson = normalizeGoldenLesson(raw, sentences)
    expect(lesson).not.toBeNull()
    if (!lesson) return
    const existing: { updatedAt: string; golden?: GoldenLesson } = {
      updatedAt: '2026-10-02T00:00:00.000Z',
      golden: lesson,
    }
    const incoming: { updatedAt: string; golden?: GoldenLesson } = { updatedAt: '2026-10-01T00:00:00.000Z' }
    expect(mergeGoldenIntoArticle(existing, incoming).golden).toBe(lesson)
    const newer: { updatedAt: string; golden?: GoldenLesson } = {
      updatedAt: '2026-10-03T00:00:00.000Z',
      golden: { ...lesson, summary: '新' },
    }
    expect(mergeGoldenIntoArticle(existing, newer).golden?.summary).toBe('新')
  })
})
