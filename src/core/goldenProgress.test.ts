import { describe, expect, it } from 'vitest'
import { buildLocalGoldenLesson, goldenDrillKey, goldenRecordId } from './golden'
import {
  emptyGoldenRecord,
  goldenCompleted,
  goldenMastered,
  mergeGoldenDrills,
  normalizeGoldenDrills,
  recordGoldenStep,
  summarizeGolden,
} from './goldenProgress'
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

const sentence = S('s1', 'Team spirit is one of the main factors.', {
  translation: '团队精神是主要因素之一。',
  language: { phrases: ['team spirit — 团队精神'] },
})

function record() {
  return emptyGoldenRecord('a1', '文章', 's1', goldenDrillKey(sentence.text, buildLocalGoldenLesson([sentence]).sentences[0].targets), '2026-10-27T00:00:00.000Z')
}

describe('golden progress', () => {
  it('首次答错后重试不会改回“首次正确”；三步 + 小结才算掌握', () => {
    let r = record()
    r = recordGoldenStep(r, 'fill', false, '2026-10-27T00:01:00.000Z')
    r = recordGoldenStep(r, 'fill', true, '2026-10-27T00:02:00.000Z')
    expect(r.fillFirst).toBe(false)
    expect(r.fillTries).toBe(2)
    r = recordGoldenStep(r, 'assemble', true, '2026-10-27T00:03:00.000Z')
    expect(goldenMastered(r)).toBe(false)
    r = recordGoldenStep(r, 'summary', true, '2026-10-27T00:04:00.000Z')
    r = recordGoldenStep(r, 'recall', true, '2026-10-27T00:05:00.000Z')
    expect(goldenCompleted(r)).toBe(true)
    expect(goldenMastered(r)).toBe(false)
  })

  it('三步首答全对 + 看过小结 = 掌握', () => {
    let r = record()
    r = recordGoldenStep(r, 'fill', true, '2026-10-27T00:01:00.000Z')
    r = recordGoldenStep(r, 'assemble', true, '2026-10-27T00:02:00.000Z')
    r = recordGoldenStep(r, 'summary', true, '2026-10-27T00:03:00.000Z')
    r = recordGoldenStep(r, 'recall', true, '2026-10-27T00:04:00.000Z')
    expect(goldenMastered(r)).toBe(true)
    expect(r.completedAt).toBe('2026-10-27T00:04:00.000Z')
  })

  it('坏记录逐条丢弃；同 id 合并保留已掌握', () => {
    const good = record()
    const out = normalizeGoldenDrills([
      good,
      { ...good, id: 'bad', at: 'not-a-date' },
      { foo: 1 },
      null,
    ])
    expect(out).toHaveLength(1)
    const merged = mergeGoldenDrills([{ ...good, mastered: true, fillFirst: true, assembleFirst: true, recallFirst: true, summarySeen: true }], [good])
    expect(merged[0].mastered).toBe(true)
    expect(merged[0].id).toBe(goldenRecordId('a1', 's1', good.drillKey))
  })

  it('统计默认按句独立；去重开关只影响计数', () => {
    const lesson = buildLocalGoldenLesson([sentence], undefined, { selected: ['s1'] })
    const rec = { ...record(), mastered: true, fillFirst: true, assembleFirst: true, recallFirst: true, summarySeen: true }
    const summary = summarizeGolden(lesson, [{ id: 's1', text: sentence.text }], [rec], 'a1')
    expect(summary.selectedSentences).toBe(1)
    expect(summary.masteredSentences).toBe(1)
    expect(summary.totalTargets).toBe(lesson.sentences[0].targets.length)
    expect(summary.masteredTargets).toBe(summary.totalTargets)
    const deduped = summarizeGolden({ ...lesson, options: { dedupe: true } }, [{ id: 's1', text: sentence.text }], [rec], 'a1')
    expect(deduped.selectedSentences).toBe(1)
  })
})
