import { describe, expect, it } from 'vitest'
import { buildLocalGoldenLesson, goldenDrillKey } from './golden'
import { goldenToMarkdown } from './goldenMarkdown'
import { emptyGoldenRecord } from './goldenProgress'
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
  language: { phrases: ['in response to — 为了应对'], grammar: '现在完成时' },
})

describe('goldenToMarkdown', () => {
  it('导出主旨、金句、译文、学习点；带进度时打勾', () => {
    const s = S()
    const lesson = buildLocalGoldenLesson([s], undefined, { selected: ['s1'] })
    const rec = {
      ...emptyGoldenRecord('a1', undefined, 's1', goldenDrillKey(s.text, lesson.sentences[0].targets), '2026-10-27T00:00:00.000Z'),
      mastered: true,
    }
    const md = goldenToMarkdown(lesson, {
      title: 'Conditions for green growth',
      sentences: [{ id: s.id, text: s.text }],
      records: [rec],
      articleId: 'a1',
      includeProgress: true,
    })
    expect(md).toContain('# Conditions for green growth')
    expect(md).toContain('**In response to the pandemic')
    expect(md).toContain('为了应对疫情')
    expect(md).toContain('搭配：in response to')
    expect(md).toContain('### s1 ✅')
  })

  it('默认不带进度勾，避免把学习状态混进素材', () => {
    const s = S()
    const lesson = buildLocalGoldenLesson([s], undefined, { selected: ['s1'] })
    const md = goldenToMarkdown(lesson, { title: 'T', sentences: [{ id: s.id, text: s.text }] })
    expect(md).not.toContain('✅')
  })
})
