import { describe, expect, it } from 'vitest'
import { goldenDrillKey, goldenTargetsFor } from './golden'
import {
  buildGoldenExamPrompt,
  buildGoldenExamFeedbackPrompt,
  buildLocalGoldenExam,
  buildLocalGoldenExamItem,
  examToImitation,
  goldenExamAfter,
  goldenExamCompletedIds,
  goldenExamUnlocked,
  normalizeGoldenExam,
  parseGoldenExam,
  pruneGoldenExam,
} from './goldenExam'
import type { GoldenDrillRecord } from './goldenProgress'
import type { GoldenLesson } from '../types/document'

const meta = {
  id: 's1',
  text: 'In response to the pandemic, remote collaboration has become the new norm.',
  translation: '为了应对疫情，远程协作已经成为新常态。',
}

const lesson: GoldenLesson = {
  version: 1,
  source: 'local',
  outline: [],
  sentences: [
    {
      id: 's1',
      zh: meta.translation,
      pattern: 'In response to + n., … has become …',
      targets: [
        { en: 'in response to', zh: '为了应对', kind: 'collocation' },
        { en: 'has become', zh: '已经成为', kind: 'tense' },
      ],
    },
  ],
  selected: ['s1'],
  options: { examAfter: 5 },
}

const key = goldenDrillKey(meta.text, goldenTargetsFor(lesson, 's1'))

function record(over: Partial<GoldenDrillRecord> = {}): GoldenDrillRecord {
  return {
    id: 'r1',
    articleId: 'a1',
    sentenceId: 's1',
    drillKey: key,
    at: '2026-10-27T00:00:00.000Z',
    fillTries: 1,
    assembleTries: 1,
    recallTries: 0,
    summarySeen: true,
    mastered: false,
    ...over,
  }
}

describe('goldenExam', () => {
  it('完成口径：只认内容指纹匹配且看过小结的句子', () => {
    expect(goldenExamCompletedIds(lesson, [meta], [], 'a1')).toEqual([])
    expect(goldenExamCompletedIds(lesson, [meta], [record()], 'a1')).toEqual(['s1'])
    expect(goldenExamCompletedIds(lesson, [meta], [record({ drillKey: 'old' })], 'a1')).toEqual([])
    expect(goldenExamCompletedIds(lesson, [meta], [record({ articleId: 'other' })], 'a1')).toEqual([])
    expect(goldenExamUnlocked(lesson, [meta], [record()], 'a1')).toBe(false)
  })

  it('本地出题：中文题干 + 原句范句 + 已学词块 + rubric', () => {
    const items = buildLocalGoldenExam(lesson, [meta], [record()], 'a1')
    expect(items).toHaveLength(1)
    expect(items[0].sentenceId).toBe('s1')
    expect(items[0].model).toBe(meta.text)
    expect(items[0].task).toContain('仿写')
    expect(items[0].task).toContain(meta.translation)
    expect(items[0].mustUse).toEqual(['in response to', 'has become'])
    expect(items[0].source).toBe('local')
    expect(items[0].rubric.reduce((n, r) => n + r.weight, 0)).toBe(100)
  })

  it('单句仿写不依赖整课完成：当前句有内容就能出题', () => {
    const item = buildLocalGoldenExamItem(lesson, [meta], 's1')
    expect(item?.sentenceId).toBe('s1')
    expect(item?.model).toBe(meta.text)
    expect(item?.task).toContain('仿写')
    expect(buildLocalGoldenExamItem(lesson, [meta], 'missing')).toBeNull()
  })

  it('AI 题：只保留原句里真实出现的 mustUse；坏句子 id 丢弃', () => {
    const raw = JSON.stringify({
      items: [
        {
          sentenceId: 's1',
          task: '用这个结构写一句关于环保的新句子。',
          structure: 'In response to + n., … has become …',
          mustUse: ['has become', 'invented phrase'],
          rubric: [{ dimension: '结构运用', weight: 60 }],
        },
        { sentenceId: 'missing', task: '坏题' },
      ],
    })
    const items = parseGoldenExam(raw, [meta])
    expect(items).toHaveLength(1)
    expect(items[0].source).toBe('ai')
    expect(items[0].mustUse).toEqual(['has become'])
    expect(items[0].model).toBe(meta.text)
  })

  it('出题/批改提示词复用现有仿写任务结构', () => {
    const prompt = buildGoldenExamPrompt({
      title: 'A',
      sentences: [{ id: 's1', text: meta.text, translation: meta.translation, pattern: '...', targets: ['in response to'] }],
    })
    expect(prompt).toContain('"items"')
    expect(prompt).toContain('s1')
    expect(prompt).toContain('不要改写范句')

    const item = buildLocalGoldenExam(lesson, [meta], [record()], 'a1')[0]
    const task = examToImitation(item)
    expect(task.model).toBe(meta.text)
    expect(task.mustUse).toEqual(item.mustUse)
    expect(buildGoldenExamFeedbackPrompt(item, 'In response to the flood, rescue teams have become faster.'))
      .toContain('学生作答')
  })

  it('门槛可调 5/10；旧题在正文变化后自动淘汰', () => {
    expect(goldenExamAfter(lesson)).toBe(5)
    expect(goldenExamAfter({ ...lesson, options: { examAfter: 10 } })).toBe(10)
    const items = buildLocalGoldenExam(lesson, [meta], [record()], 'a1')
    expect(pruneGoldenExam(items, [{ ...meta, text: 'Changed.' }])).toBeUndefined()
    expect(pruneGoldenExam(items, [meta])).toHaveLength(1)
    expect(normalizeGoldenExam({ items: [] }, [meta])).toEqual([])
  })
})
