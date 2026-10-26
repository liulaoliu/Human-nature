import { describe, expect, it } from 'vitest'
import {
  addBackTranslationRecord,
  buildBackTranslationPrompt,
  compareToReference,
  diffWords,
  makeBackTranslationId,
  normalizeBackTranslationFeedback,
  normalizeBackTranslationRecords,
  parseBackTranslationFeedback,
  type BackTranslationRecord,
} from './backTranslate'

const feedbackJson = JSON.stringify({
  scores: [
    { dimension: '意思还原', score: 36, max: 40, comment: '信息完整' },
    { dimension: '语法', score: 26, max: 30 },
    { dimension: '用词与搭配', score: 16, max: 20 },
    { dimension: '连贯简洁', score: 8, max: 10 },
  ],
  total: 999,
  max: 999,
  issues: [
    {
      original: 'Rachman',
      suggestion: 'Rahman',
      reason: '音译无法从中文唯一确定，不计分',
      type: 'properNoun',
    },
    {
      original: 'go to school',
      suggestion: 'went to school',
      reason: '时态错',
      type: 'grammar',
      deduct: true,
    },
  ],
  polished: 'He went to school.',
  alternatives: ['He attended school.'],
  summary: '注意时态。',
})

describe('buildBackTranslationPrompt', () => {
  it('把原文标成参考，并把专名三档规则写进提示词', () => {
    const prompt = buildBackTranslationPrompt({
      sourceZh: '他去了学校。',
      reference: 'He went to school.',
      contextZh: '昨天天气很好。',
      articleTitle: 'A Day',
    })
    expect(prompt).toContain('不是唯一答案')
    expect(prompt).toContain('冷门音译')
    expect(prompt).toContain('deduct=false')
    expect(prompt).toContain('他去了学校。')
    expect(prompt).toContain('He went to school.')
    expect(prompt).toContain('上一句中文')
    expect(prompt).toContain('A Day')
  })
})

describe('parseBackTranslationFeedback', () => {
  it('解析出分数；总分按维度重算，不信模型给的 total', () => {
    const f = parseBackTranslationFeedback('```json\n' + feedbackJson + '\n```')
    expect(f).not.toBeNull()
    expect(f!.scores).toHaveLength(4)
    expect(f!.total).toBe(86)
    expect(f!.max).toBe(100)
    expect(f!.alternatives).toEqual(['He attended school.'])
    expect(f!.polished).toBe('He went to school.')
  })

  it('专名提示默认不计分；语法问题默认计分', () => {
    const f = parseBackTranslationFeedback(feedbackJson)!
    expect(f.issues[0]).toMatchObject({ type: 'properNoun', deduct: false })
    expect(f.issues[1]).toMatchObject({ type: 'grammar', deduct: true })
  })

  it('坏 JSON / 空结构直接返回 null，不放水', () => {
    expect(parseBackTranslationFeedback('not json')).toBeNull()
    expect(parseBackTranslationFeedback('{}')).toBeNull()
    expect(parseBackTranslationFeedback(JSON.stringify({ issues: [] }))).toBeNull()
    expect(normalizeBackTranslationFeedback({ scores: 'bad' })).toBeNull()
  })
})

describe('compareToReference', () => {
  it('忽略大小写、首尾空白和句末标点；完全一致给 exact', () => {
    const c = compareToReference('  He went to school  ', 'He went to school.')
    expect(c.exact).toBe(true)
    expect(c.ratio).toBe(1)
    expect(c.tier).toBe('exact')
  })

  it('同义改写不相等，但给出可展示的接近度', () => {
    const c = compareToReference('He went to the school.', 'He went to school.')
    expect(c.exact).toBe(false)
    expect(c.ratio).toBeGreaterThan(0.8)
    expect(c.ratio).toBeLessThan(1)
    expect(c.tier).toBe('fair')
  })

  it('完全不同的句子接近度低', () => {
    const c = compareToReference('The cat sat on the mat.', 'He went to school.')
    expect(c.tier).toBe('loose')
  })
})

describe('diffWords', () => {
  it('标出漏词和多词', () => {
    const parts = diffWords('He went school', 'He went to school')
    expect(parts.some((p) => p.kind === 'same' && p.text.includes('school'))).toBe(true)
    expect(parts.some((p) => p.kind === 'add' && p.text.includes('to'))).toBe(true)
  })
})

describe('存档记录', () => {
  const rec: BackTranslationRecord = {
    id: makeBackTranslationId('2026-10-26T00:00:00.000Z', 'a1', 's1', 'He went to school.'),
    at: '2026-10-26T00:00:00.000Z',
    articleId: 'a1',
    articleTitle: 'A Day',
    sentenceId: 's1',
    sourceZh: '他去了学校。',
    answer: 'He went to school.',
    reference: 'He went to school.',
    feedback: parseBackTranslationFeedback(feedbackJson)!,
    closeness: { exact: true, ratio: 1 },
    gradedBy: 'local',
  }

  it('同一 id 不重复追加；新记录在前', () => {
    const first = addBackTranslationRecord([], rec)
    expect(addBackTranslationRecord(first, rec)).toBe(first)
    const newer = { ...rec, id: 'newer', at: '2026-10-27T00:00:00.000Z' }
    expect(addBackTranslationRecord(first, newer)[0].id).toBe('newer')
  })

  it('normalize 丢坏条目，保留自包含的好记录', () => {
    const out = normalizeBackTranslationRecords([
      rec,
      { ...rec, id: 'bad', sourceZh: '' },
      { ...rec, id: 'bad2', feedback: { scores: [] } },
      null,
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: rec.id, articleTitle: 'A Day', sourceZh: '他去了学校。' })
  })

  it('缺 closeness 时按答案和原句补算', () => {
    const { closeness: _drop, ...old } = rec
    const out = normalizeBackTranslationRecords([old])
    expect(out[0].closeness.exact).toBe(true)
    expect(out[0].closeness.ratio).toBe(1)
  })
})
