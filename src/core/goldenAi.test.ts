import { describe, expect, it } from 'vitest'
import { buildLocalGoldenLesson } from './golden'
import { buildGoldenPrompt, mergeGoldenLessons, parseGoldenLesson } from './goldenAi'
import type { Sentence } from '../types/document'

const S = (): Sentence => ({
  id: 's1',
  paraId: 'p01',
  text: 'In response to the pandemic, remote collaboration has become the new norm.',
  audio: null,
  translation: '为了应对疫情，远程协作已经成为新常态。',
  grammarNote: null,
  collocations: [],
  vocab: [],
  tags: [],
  reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
  language: { phrases: ['remote collaboration — 远程协作'] },
})

const sentence = S()

const raw = JSON.stringify({
  summary: '远程协作成为新常态。',
  outline: [{ paraId: 'p01', role: 'intro', points: ['疫情推动远程协作'] }],
  selected: ['s1'],
  sentences: [
    {
      id: 's1',
      zh: '为了应对疫情，远程协作已经成为新常态。',
      pattern: 'In response to + n., … has become …',
      tense: '现在完成时',
      targets: [
        { en: 'in response to', zh: '为了应对', kind: 'collocation' },
        { en: 'has become', zh: '已经成为', kind: 'tense' },
        { en: 'made up', zh: '编造', kind: 'word' },
      ],
    },
  ],
})

describe('golden AI', () => {
  it('提示词写清筛选标准、目标类型和“逐字出现”', () => {
    const p = buildGoldenPrompt({ title: 'T', sentences: [{ id: 's1', text: sentence.text, translation: sentence.translation ?? undefined }] })
    expect(p).toContain('最多挑 10 句')
    expect(p).toContain('pattern / tense / collocation / idiom / usage / word')
    expect(p).toContain('必须是原句的逐字片段')
    expect(p).toContain('覆盖本句所有可迁移语言点')
    expect(p).toContain('s1')
  })

  it('解析：容忍围栏/前后废话，编造目标被丢掉', () => {
    const parsed = parseGoldenLesson('```json\n' + raw + '\n```', [sentence])
    expect(parsed).not.toBeNull()
    expect(parsed?.source).toBe('ai')
    expect(parsed?.sentences[0].targets.map((t) => t.en)).toEqual(['in response to', 'has become'])
  })

  it('坏 JSON / 句子 id 对不上返回 null', () => {
    expect(parseGoldenLesson('not json', [sentence])).toBeNull()
    const wrong = JSON.stringify({ selected: ['s404'], sentences: [{ id: 's404', targets: [] }] })
    expect(parseGoldenLesson(wrong, [sentence])).toBeNull()
  })

  it('合并：AI 注释优先，AI 缺的句子/目标用本地补', () => {
    const local = buildLocalGoldenLesson([sentence], undefined, { selected: ['s1'] })
    const ai = parseGoldenLesson(raw, [sentence])
    expect(ai).not.toBeNull()
    if (!ai) return
    const merged = mergeGoldenLessons(local, ai, [sentence])
    expect(merged.source).toBe('merged')
    expect(merged.summary).toBe('远程协作成为新常态。')
    expect(merged.sentences[0].pattern).toContain('In response to')
    expect(merged.sentences[0].targets.map((t) => t.en)).toEqual(['in response to', 'remote collaboration', 'has become'])
  })
})
