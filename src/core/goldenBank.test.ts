import { describe, expect, it } from 'vitest'
import {
  buildGoldenBank,
  filterGoldenBank,
  goldenBankToAnkiCSV,
  goldenBankToMarkdown,
  goldenBankToPrintHTML,
} from './goldenBank'
import { buildLocalGoldenLesson, goldenDrillKey } from './golden'
import { emptyGoldenRecord } from './goldenProgress'
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

const sentence = S('s1', 'In response to the pandemic, remote collaboration has become the new norm.', {
  translation: '为了应对疫情，远程协作已经成为新常态。',
  language: { phrases: ['in response to — 为了应对'], grammar: '现在完成时' },
})

describe('全库金句本', () => {
  const lesson = buildLocalGoldenLesson([sentence], undefined, { selected: ['s1'] })
  const sources = [{ id: 'a1', title: 'A 篇', sentences: [sentence], golden: lesson }]

  it('摊平金句并带上掌握状态', () => {
    const rec = {
      ...emptyGoldenRecord('a1', 'A 篇', 's1', goldenDrillKey(sentence.text, lesson.sentences[0].targets), '2026-01-01T00:00:00.000Z'),
      mastered: true,
      fillFirst: true,
      assembleFirst: true,
      recallFirst: true,
      summarySeen: true,
    }
    const rows = buildGoldenBank(sources, [rec], new Date('2026-01-02T00:00:00.000Z'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ articleId: 'a1', sentenceId: 's1', mastered: true, due: true })
  })

  it('搜索 / 状态筛选', () => {
    const rows = buildGoldenBank(sources, [], new Date('2026-01-02T00:00:00.000Z'))
    expect(filterGoldenBank(rows, { query: '远程' })).toHaveLength(1)
    expect(filterGoldenBank(rows, { query: '不存在的词' })).toHaveLength(0)
    expect(filterGoldenBank(rows, { status: 'todo' })).toHaveLength(1)
    expect(filterGoldenBank(rows, { status: 'mastered' })).toHaveLength(0)
  })

  it('按学习点类型筛：句子里有该类型才命中', () => {
    const rows = buildGoldenBank(sources, [], new Date('2026-01-02T00:00:00.000Z'))
    const kinds = new Set(rows[0].targets.map((t) => t.kind))
    expect(kinds.size).toBeGreaterThan(0)
    const hit = [...kinds][0]
    expect(filterGoldenBank(rows, { kind: hit })).toHaveLength(1)
    // 不存在的类型（或这句没有的类型）→ 0 条
    expect(filterGoldenBank(rows, { kind: 'tense' })).toHaveLength(kinds.has('tense') ? 1 : 0)
    expect(filterGoldenBank(rows, { kind: 'all' })).toHaveLength(1)
    // 类型和状态/搜索一起用：取交集
    expect(filterGoldenBank(rows, { kind: hit, query: '远程' })).toHaveLength(1)
    expect(filterGoldenBank(rows, { kind: hit, query: '不存在的词' })).toHaveLength(0)
  })

  it('Markdown / Anki 导出', () => {
    const rows = buildGoldenBank(sources, [], new Date('2026-01-02T00:00:00.000Z'))
    const md = goldenBankToMarkdown(rows)
    expect(md).toContain('# 全库金句本')
    expect(md).toContain('## A 篇')
    expect(md).toContain('In response to the pandemic')
    const csv = goldenBankToAnkiCSV(rows)
    expect(csv.split('\n')[0]).toBe('Front,Back,Tags')
    expect(csv).toContain('In response to the pandemic')
    const html = goldenBankToPrintHTML(rows)
    expect(html).toContain('<title>全库金句本</title>')
    expect(html).toContain('In response to the pandemic')
    expect(html).toContain('columns: 2')
  })
})
