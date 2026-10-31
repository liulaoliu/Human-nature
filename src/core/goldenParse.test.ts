import { describe, expect, it } from 'vitest'
import { goldenDrillKey } from './golden'
import { mergeGoldenIntoArticle, normalizeGoldenLesson, pruneGoldenLesson } from './goldenParse'
import type { GoldenLesson } from '../types/document'

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

  it('本课设置保留填空单位；旧数据缺省不在解析层硬写', () => {
    const target = normalizeGoldenLesson({ ...raw, options: { blankUnit: 'target' } }, sentences)
    expect(target?.options?.blankUnit).toBe('target')
    const old = normalizeGoldenLesson(raw, sentences)
    expect(old?.options?.blankUnit).toBeUndefined()
  })

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

  it('仿写考试题随课程解析；改正文后对不上的题被 prune', () => {
    const withExam = normalizeGoldenLesson(
      {
        ...raw,
        options: { examAfter: 10 },
        exam: [
          {
            sentenceId: 's1',
            task: '用这个结构写一句新句子。',
            model: sentences[0].text,
            mustUse: ['in response to', 'invented phrase'],
            rubric: [{ dimension: '结构运用', weight: 100 }],
          },
          { sentenceId: 's404', task: '坏题' },
        ],
      },
      sentences,
    )
    expect(withExam?.options?.examAfter).toBe(10)
    expect(withExam?.exam).toHaveLength(1)
    expect(withExam?.exam?.[0].mustUse).toEqual(['in response to'])
    expect(pruneGoldenLesson(withExam!, sentences)?.exam).toHaveLength(1)
    expect(pruneGoldenLesson(withExam!, [{ id: 's1', text: 'Completely different.' }])).toBeUndefined()
  })

  it('extraPoints：只留当前句子，同英文去重，坏 kind 归 chunk', () => {
    const lesson = normalizeGoldenLesson(
      {
        ...raw,
        extraPoints: [
          { sentenceId: 's1', en: 'come to an end', zh: '结束', kind: 'chunk', source: 'ai' },
          { sentenceId: 's1', en: 'come  to an end', kind: 'weird' },
          { sentenceId: 's404', en: 'gone', kind: 'chunk' },
        ],
      },
      sentences,
    )
    expect(lesson?.extraPoints).toHaveLength(1)
    expect(lesson?.extraPoints?.[0]).toMatchObject({ sentenceId: 's1', kind: 'chunk', source: 'ai' })
  })

  it('导入合并时 extraPoints 取并集，不因重新生成丢掉', () => {
    const base = normalizeGoldenLesson(
      { ...raw, extraPoints: [{ sentenceId: 's1', en: 'come to an end', kind: 'chunk' }] },
      sentences,
    )!
    const next = normalizeGoldenLesson(
      { ...raw, summary: '新', extraPoints: [{ sentenceId: 's1', en: 'bring an end to', kind: 'chunk' }] },
      sentences,
    )!
    const existing = { updatedAt: '2026-10-01T00:00:00.000Z', golden: base }
    const incoming = { updatedAt: '2026-10-02T00:00:00.000Z', golden: next }
    expect(mergeGoldenIntoArticle(existing, incoming).golden?.extraPoints?.map((p) => p.en)).toEqual([
      'come to an end',
      'bring an end to',
    ])
  })

  it('prune 后句子没了，extraPoints 也不留', () => {
    const lesson = normalizeGoldenLesson(
      { ...raw, extraPoints: [{ sentenceId: 's1', en: 'come to an end', kind: 'chunk' }] },
      sentences,
    )!
    expect(pruneGoldenLesson(lesson, [{ id: 's1', text: 'Completely different.' }])).toBeUndefined()
    expect(pruneGoldenLesson(lesson, sentences)?.extraPoints).toHaveLength(1)
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
