import { describe, expect, it } from 'vitest'
import { defaultReviewState, type VocabItem } from '../types/document'
import {
  buildDrillSentenceItem,
  DRILL_SENTENCE_MAX_POINTS,
  drillSentenceId,
  drillSentenceKindLabel,
  drillSentencePoints,
} from './drillSentence'

function item(over: Partial<VocabItem> = {}): VocabItem {
  return {
    id: 'v1',
    word: 'run',
    lemma: 'run',
    phonetic: null,
    partOfSpeech: null,
    meaning: '跑',
    usage: [],
    examples: [],
    source: null,
    status: 'queried',
    note: '',
    tags: [],
    reviewState: defaultReviewState(),
    createdAt: '2026-11-07T00:00:00.000Z',
    updatedAt: '2026-11-07T00:00:00.000Z',
    ...over,
  }
}

const result = (itemId: string) => ({ itemId })

describe('drillSentencePoints：从本轮考到的词条取造句素材', () => {
  it('记忆拷打：按结果顺序去重、缺词条跳过、带词义', () => {
    const points = drillSentencePoints(
      [item(), item({ id: 'v2', word: 'make', meaning: '制造' })],
      [result('v2'), result('missing'), result('v1'), result('v2')],
      'memory',
    )
    expect(points.map((p) => [p.en, p.zh])).toEqual([
      ['make', '制造'],
      ['run', '跑'],
    ])
    expect(points[0].itemId).toBe('v2')
    expect(points[0].id).toBe('drill:memory:v2:make')
  })

  it('记忆拷打：最多取 DRILL_SENTENCE_MAX_POINTS 个', () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      item({ id: `v${i}`, word: `word${i}`, lemma: `word${i}` }),
    )
    const points = drillSentencePoints(items, items.map((it) => result(it.id)), 'memory')
    expect(points).toHaveLength(DRILL_SENTENCE_MAX_POINTS)
    expect(points[0].en).toBe('word0')
  })

  it('词块拷打：取 phrases / idioms / 英文 usage，拆中文释义并跳过中文用法笔记', () => {
    const points = drillSentencePoints(
      [
        item({
          phrases: ['run out of — 用完', 'run into'],
          idioms: ['in the long run — 从长远看'],
          usage: ['run errands', 'so-called 常带保留态度'],
        }),
      ],
      [result('v1')],
      'chunk',
    )
    expect(points.map((p) => [p.en, p.zh])).toEqual([
      ['run out of', '用完'],
      ['run into', undefined],
      ['in the long run', '从长远看'],
      ['run errands', undefined],
    ])
    expect(points.some((p) => p.en.includes('so-called'))).toBe(false)
  })

  it('词块拷打：没有可用词块时退回单词本身，词块跨词条去重', () => {
    const fallback = drillSentencePoints([item({ phrases: [], idioms: [], usage: ['中文说明'] })], [result('v1')], 'chunk')
    expect(fallback).toEqual([
      { id: 'drill:chunk:v1:run', itemId: 'v1', en: 'run', zh: '跑' },
    ])

    const deduped = drillSentencePoints(
      [
        item({ phrases: ['run out'] }),
        item({ id: 'v2', word: 'use', lemma: 'use', meaning: '使用', phrases: ['Run Out', 'use up'] }),
      ],
      [result('v1'), result('v2')],
      'chunk',
    )
    expect(deduped.map((p) => p.en)).toEqual(['run out', 'use up'])
  })

  it('空结果 / limit=0 返回空数组', () => {
    expect(drillSentencePoints([item()], [], 'memory')).toEqual([])
    expect(drillSentencePoints([item()], [result('v1')], 'memory', 0)).toEqual([])
  })
})

describe('buildDrillSentenceItem：复用金句课批改链路', () => {
  const points = drillSentencePoints([item()], [result('v1')], 'memory')

  it('记忆拷打造句：题面带词义 / 必须用上 / 空范句 / rubric 总分 100', () => {
    const exam = buildDrillSentenceItem('memory', points)!
    expect(exam.task).toContain('本轮记忆拷打')
    expect(exam.task).toContain('run（跑）')
    expect(exam.task).toContain('不要照抄例句')
    expect(exam.model).toBe('')
    expect(exam.mustUse).toEqual(['run'])
    expect(exam.sentenceId).toBe(exam.id)
    expect(exam.id.startsWith('drill:memory:')).toBe(true)
    expect(exam.rubric.reduce((sum, r) => sum + r.weight, 0)).toBe(100)
  })

  it('词块拷打造句：题面叫词块，rubric 走词块口径', () => {
    const chunkPoints = drillSentencePoints(
      [item({ phrases: ['run out of — 用完'] })],
      [result('v1')],
      'chunk',
    )
    const exam = buildDrillSentenceItem('chunk', chunkPoints)!
    expect(exam.task).toContain('本轮词块拷打')
    expect(exam.task).toContain('run out of（用完）')
    expect(exam.rubric[0].dimension).toBe('词块使用')
    expect(exam.rubric[0].weight).toBe(50)
  })

  it('同一组素材顺序不同 → 同一个题 id（历史能归到一起）', () => {
    const a = buildDrillSentenceItem('memory', points)!
    const b = buildDrillSentenceItem('memory', [...points].reverse())!
    expect(b.id).toBe(a.id)
    expect(drillSentenceId('memory', points)).toBe(a.id)
  })

  it('没有素材 → null；kindLabel 给抬头用', () => {
    expect(buildDrillSentenceItem('chunk', [])).toBeNull()
    expect(drillSentenceKindLabel('memory')).toBe('记忆拷打')
    expect(drillSentenceKindLabel('chunk')).toBe('词块拷打')
  })
})
