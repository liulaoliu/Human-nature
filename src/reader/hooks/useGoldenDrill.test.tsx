// @vitest-environment jsdom
import { useState } from 'react'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useGoldenDrill } from './useGoldenDrill'
import type { ReaderDoc } from './useReaderDoc'
import type { GoldenDrillRecord } from '../../core/goldenProgress'
import type { Sentence } from '../../types/document'

const sentence: Sentence = {
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
  language: {
    phrases: ['in response to — 为了应对'],
    idioms: ['the new norm — 新常态'],
    grammar: '现在完成时',
  },
}

function setup() {
  const initial: ReaderDoc = { paragraphs: [{ id: 'p01', sentenceIds: ['s1'] }], sentences: [sentence] }
  const recordPractice = vi.fn()
  const recordActivity = vi.fn()
  const recordAnswer = vi.fn()
  const flash = vi.fn()
  const setPendingSave = vi.fn()
  const speak = vi.fn()
  const hook = renderHook(() => {
    const [doc, setDoc] = useState<ReaderDoc | null>(initial)
    const [records, setRecords] = useState<GoldenDrillRecord[]>([])
    const api = useGoldenDrill({
      doc,
      articleId: 'a1',
      articleTitle: '文章',
      articleKey: 'a1@x',
      records,
      recordGolden: (r) => setRecords((prev) => (prev.some((x) => x.id === r.id) ? prev.map((x) => (x.id === r.id ? r : x)) : [...prev, r])),
      recordActivity,
      recordPractice,
      recordAnswer,
      speak,
      flash,
      setDoc,
      setPendingSave,
    })
    return { api, records, doc }
  })
  return { ...hook, recordPractice, recordActivity, recordAnswer, flash, setPendingSave, speak }
}

describe('useGoldenDrill', () => {
  it('打开 → 推荐金句 → 填空/拼句/小结 → 逆向回顾 → 总结', () => {
    const h = setup()
    act(() => h.result.current.api.openGolden())
    expect(h.result.current.api.lesson?.selected).toEqual(['s1'])

    act(() => h.result.current.api.startDrill())
    expect(h.result.current.api.view).toBe('drill')
    act(() => h.result.current.api.beginFill())
    const targets = h.result.current.api.targets
    expect(targets.length).toBeGreaterThan(0)
    expect(h.result.current.api.blankUnit).toBe('word')
    let rounds = 0
    while (h.result.current.api.fillCorrect !== true && rounds++ < 20) {
      const blanks = h.result.current.api.cloze?.blanks ?? []
      act(() => h.result.current.api.setFillInputs(blanks.map((b) => b.answer)))
      act(() => h.result.current.api.checkFill())
      if (h.result.current.api.fillRoundPassed) {
        act(() => h.result.current.api.nextFillRound())
      }
    }
    expect(h.result.current.api.fillCorrect).toBe(true)
    expect(h.result.current.api.fillRoundCount).toBeGreaterThan(1)
    expect(h.result.current.records[0].fillFirst).toBe(true)

    act(() => h.result.current.api.beginAssemble())
    act(() => h.result.current.api.setAssembleOrder(targets.map((t) => t.en)))
    act(() => h.result.current.api.checkAssemble())
    expect(h.result.current.api.assembleChecked).toBe(true)

    act(() => h.result.current.api.markSummary())
    expect(h.result.current.api.phase).toBe('summary')
    expect(h.result.current.records[0].summarySeen).toBe(true)

    act(() => h.result.current.api.nextSentence())
    expect(h.result.current.api.view).toBe('recall')

    act(() => h.result.current.api.setRecallInput(sentence.text))
    act(() => h.result.current.api.checkRecall())
    expect(h.result.current.api.recallChecked?.firstOk).toBe(true)

    act(() => h.result.current.api.nextRecall())
    expect(h.result.current.api.view).toBe('summary')
    expect(h.result.current.records[0].mastered).toBe(true)
    expect(h.result.current.api.summary?.masteredSentences).toBe(1)
    expect(h.recordPractice).toHaveBeenCalledWith('golden', 1, 1)
    expect(h.recordAnswer).toHaveBeenCalled()

    // 已掌握后重练：本轮首答记录清空，但 mastered 不降级
    act(() => h.result.current.api.restartSentence())
    expect(h.result.current.records[0].mastered).toBe(true)
    expect(h.result.current.records[0].summarySeen).toBeFalsy()
  })

  it('细碎填空中途首答错，后面全对也不给 fillFirst', () => {
    const h = setup()
    act(() => h.result.current.api.openGolden())
    act(() => h.result.current.api.startDrill())
    act(() => h.result.current.api.beginFill())
    const first = h.result.current.api.cloze?.blanks ?? []
    act(() => h.result.current.api.setFillInputs(first.map((b) => (b.index === 1 ? 'wrong' : b.answer))))
    act(() => h.result.current.api.checkFill())
    expect(h.result.current.api.fillCorrect).toBe(false)

    let guard = 0
    while (h.result.current.api.fillCorrect !== true && guard++ < 20) {
      const blanks = h.result.current.api.cloze?.blanks ?? []
      act(() => h.result.current.api.setFillInputs(blanks.map((b) => b.answer)))
      act(() => h.result.current.api.checkFill())
      if (h.result.current.api.fillRoundPassed) act(() => h.result.current.api.nextFillRound())
    }
    expect(h.result.current.api.fillCorrect).toBe(true)
    expect(h.result.current.records[0].fillFirst).toBeFalsy()
  })

  it('没完成遣词造句不让进逆向回顾', () => {
    const h = setup()
    act(() => h.result.current.api.openGolden())
    act(() => h.result.current.api.startRecall())
    expect(h.result.current.api.view).toBe('home')
    expect(h.flash).toHaveBeenCalledWith('先完成全部句子的遣词造句，再进逆向回顾')
  })
})
