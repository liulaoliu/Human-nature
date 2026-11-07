import { describe, expect, it } from 'vitest'
import { defaultReviewState, type VocabItem } from '../types/document'
import type { QuizQuestion } from './quiz'
import {
  buildDrillSentenceItem,
  buildDrillSentenceItems,
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

const result = (itemId: string, id = `q:${itemId}`) => ({ id, itemId })

function question(over: Partial<QuizQuestion> = {}): QuizQuestion {
  return {
    id: 'q1',
    itemId: 'v1',
    lemma: 'run',
    kind: 'usage',
    word: 'run',
    prompt: '',
    meaning: '跑',
    partOfSpeech: null,
    phonetic: null,
    answer: 'run',
    accept: ['run'],
    ...over,
  }
}

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

  it('记忆拷打：默认每个考试内容一个点，不截断；显式 limit 才截断', () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      item({ id: `v${i}`, word: `word${i}`, lemma: `word${i}` }),
    )
    const results = items.map((it) => result(it.id))
    expect(drillSentencePoints(items, results, 'memory')).toHaveLength(8)
    expect(drillSentencePoints(items, results, 'memory', { limit: 3 })).toHaveLength(3)
  })

  it('词块拷打：每个词条只取第一条可写进句子的词块', () => {
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
    expect(points.map((p) => [p.en, p.zh])).toEqual([['run out of', '用完']])
    expect(points).toHaveLength(1)
    expect(points.some((p) => p.en.includes('so-called'))).toBe(false)
  })

  it('词块拷打：有本轮题目时，优先取实际考过的那条词块', () => {
    const points = drillSentencePoints(
      [item({ phrases: ['run out of — 用完'], idioms: ['in the long run — 从长远看'] })],
      [result('v1', 'q1')],
      'chunk',
      {
        questions: [
          question({ id: 'q1', itemId: 'v1', kind: 'idiom', context: 'in the long run — 从长远看' }),
        ],
      },
    )
    expect(points.map((p) => [p.en, p.zh])).toEqual([['in the long run', '从长远看']])
  })

  it('词块拷打：没有可用词块时退回单词本身，词块跨词条去重', () => {
    const fallback = drillSentencePoints(
      [item({ phrases: [], idioms: [], usage: ['中文说明'] })],
      [result('v1')],
      'chunk',
    )
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
    expect(drillSentencePoints([item()], [result('v1')], 'memory', { limit: 0 })).toEqual([])
  })
})

describe('buildDrillSentenceItem：每个考试内容独立一道题', () => {
  const point = drillSentencePoints([item()], [result('v1')], 'memory')[0]!

  it('记忆拷打造句：题面只出现一个词 + 词义，必须用上只有一个', () => {
    const exam = buildDrillSentenceItem('memory', point)
    expect(exam.task).toContain('本轮记忆拷打')
    expect(exam.task).toContain('run（跑）')
    expect(exam.task).toContain('这个单词')
    expect(exam.task).toContain('只练这一个单词')
    expect(exam.task).not.toContain('全部用上')
    expect(exam.model).toBe('')
    expect(exam.mustUse).toEqual(['run'])
    expect(exam.sentenceId).toBe(exam.id)
    expect(exam.id.startsWith('drill:memory:')).toBe(true)
    expect(exam.rubric.reduce((sum, r) => sum + r.weight, 0)).toBe(100)
  })

  it('词块拷打造句：题面只出现一个词块，rubric 走词块口径', () => {
    const chunkPoint = drillSentencePoints(
      [item({ phrases: ['run out of — 用完', 'run into'] })],
      [result('v1')],
      'chunk',
    )[0]!
    const exam = buildDrillSentenceItem('chunk', chunkPoint)
    expect(exam.task).toContain('本轮词块拷打')
    expect(exam.task).toContain('run out of（用完）')
    expect(exam.task).toContain('这个词块')
    expect(exam.task).not.toContain('run into')
    expect(exam.mustUse).toEqual(['run out of'])
    expect(exam.rubric[0].dimension).toBe('词块使用')
    expect(exam.rubric[0].weight).toBe(50)
  })

  it('每个点各一道题：两个内容不会混进同一题', () => {
    const points = drillSentencePoints(
      [item(), item({ id: 'v2', word: 'make', meaning: '制造' })],
      [result('v1'), result('v2')],
      'memory',
    )
    const exams = buildDrillSentenceItems('memory', points)
    expect(exams).toHaveLength(2)
    expect(exams.map((e) => e.mustUse)).toEqual([['run'], ['make']])
    expect(exams[0].task).toContain('run（跑）')
    expect(exams[0].task).not.toContain('make')
    expect(exams[1].task).toContain('make（制造）')
    expect(exams[1].task).not.toContain('run')
    expect(exams[0].id).not.toBe(exams[1].id)
  })

  it('同一个点 → 稳定 id；不同点 → 不同 id', () => {
    const a = buildDrillSentenceItem('memory', point)
    const b = buildDrillSentenceItem('memory', point)
    expect(b.id).toBe(a.id)
    expect(drillSentenceId('memory', [point])).toBe(a.id)

    const other = drillSentencePoints(
      [item({ id: 'v2', word: 'make', meaning: '制造' })],
      [result('v2')],
      'memory',
    )[0]!
    expect(buildDrillSentenceItem('memory', other).id).not.toBe(a.id)
  })

  it('没有素材 → 空数组；kindLabel 给抬头用', () => {
    expect(buildDrillSentenceItems('chunk', [])).toEqual([])
    expect(drillSentenceKindLabel('memory')).toBe('记忆拷打')
    expect(drillSentenceKindLabel('chunk')).toBe('词块拷打')
  })
})
