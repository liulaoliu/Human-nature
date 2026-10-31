// @vitest-environment jsdom
import { useState } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeStorage } from '../testStorage'
import { useGoldenDrill } from './useGoldenDrill'
import type { ReaderDoc } from './useReaderDoc'
import { buildLocalGoldenLesson, goldenDrillKey, goldenTargetsFor } from '../../core/golden'
import { emptyGoldenRecord, recordGoldenStep, type GoldenDrillRecord } from '../../core/goldenProgress'
import type { Sentence } from '../../types/document'

// useGoldenSession 会把「走到哪一步」写进本机会话快照，openGolden() 再读回来恢复视图。
// 不隔离 storage 就会跨用例污染：上一条停在 drill / summary，下一条 openGolden() 一开就
// 不是 home，用例按声明顺序红在第四条（2026-10-28 引入会话恢复时踩过）。
let restoreStorage: () => void = () => {}

beforeEach(() => {
  restoreStorage = installFakeStorage()
})

afterEach(() => {
  restoreStorage()
})

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

const sentence2: Sentence = {
  ...sentence,
  id: 's2',
  text: 'Small habits compound into remarkable results over time.',
  translation: '小习惯会随时间累积成显著的结果。',
  language: {
    phrases: ['compound into — 累积成'],
    idioms: [],
    grammar: '一般现在时',
  },
}

const defaultDoc: ReaderDoc = { paragraphs: [{ id: 'p01', sentenceIds: ['s1'] }], sentences: [sentence] }

/** 造两份「已掌握、昨天学过」的记录，让待回顾队列立刻有内容。 */
function dueRecords(doc: ReaderDoc): GoldenDrillRecord[] {
  const ids = doc.sentences.map((s) => s.id)
  const lesson = buildLocalGoldenLesson(doc.sentences, doc.paragraphs, { selected: ids })
  const at = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  return ids.map((id) => {
    const s = doc.sentences.find((x) => x.id === id)
    if (!s) throw new Error(`missing sentence ${id}`)
    const key = goldenDrillKey(s.text, goldenTargetsFor(lesson, id))
    let record = emptyGoldenRecord('a1', '文章', id, key, at)
    for (const step of ['fill', 'assemble', 'recall', 'summary'] as const) {
      record = recordGoldenStep(record, step, true, at)
    }
    return record
  })
}

function setup(initial: ReaderDoc = defaultDoc, initialRecords: GoldenDrillRecord[] = []) {
  const recordPractice = vi.fn()
  const recordActivity = vi.fn()
  const recordAnswer = vi.fn()
  const flash = vi.fn()
  const setPendingSave = vi.fn()
  const speak = vi.fn()
  const hook = renderHook(() => {
    const [doc, setDoc] = useState<ReaderDoc | null>(initial)
    const [records, setRecords] = useState<GoldenDrillRecord[]>(initialRecords)
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

  it('去练：未选进本课的句子会补选并直接进入填空', () => {
    const doc: ReaderDoc = {
      paragraphs: [{ id: 'p01', sentenceIds: ['s1', 's2'] }],
      sentences: [sentence, sentence2],
      golden: buildLocalGoldenLesson([sentence, sentence2], undefined, { selected: ['s1'] }),
    }
    const h = setup(doc)
    act(() => h.result.current.api.openGolden())
    act(() => {
      expect(h.result.current.api.startSentenceDrill('s2')).toBe(true)
    })
    expect(h.result.current.api.currentSentence?.id).toBe('s2')
    expect(h.result.current.api.view).toBe('drill')
    expect(h.result.current.api.phase).toBe('fill')
    expect(h.result.current.api.lesson?.selected).toContain('s2')
  })

  it('去练：当前文章没有这句时返回 false，交给界面提示', () => {
    const h = setup()
    act(() => h.result.current.api.openGolden())
    let ok = true
    act(() => {
      ok = h.result.current.api.startSentenceDrill('s404')
    })
    expect(ok).toBe(false)
    expect(h.result.current.api.view).toBe('home')
  })

  it('回看上一句：练过的句子直接落在小结，没练过的从预览开始', () => {
    const doc: ReaderDoc = {
      paragraphs: [{ id: 'p01', sentenceIds: ['s1', 's2'] }],
      sentences: [sentence, sentence2],
    }
    const lesson = buildLocalGoldenLesson(doc.sentences, doc.paragraphs, { selected: ['s1', 's2'] })
    const at = new Date().toISOString()
    let rec = emptyGoldenRecord('a1', '文章', 's1', goldenDrillKey(sentence.text, goldenTargetsFor(lesson, 's1')), at)
    for (const step of ['fill', 'assemble', 'recall', 'summary'] as const) rec = recordGoldenStep(rec, step, true, at)
    const h = setup(doc, [rec])
    act(() => h.result.current.api.openGolden())
    act(() => h.result.current.api.startDrill(1))
    expect(h.result.current.api.index).toBe(1)
    expect(h.result.current.api.phase).toBe('preview')

    // 第 1 句已练过 → 回看直接看小结
    act(() => h.result.current.api.prevSentence())
    expect(h.result.current.api.index).toBe(0)
    expect(h.result.current.api.phase).toBe('summary')

    // 再回到第 2 句（没练过）→ 预览
    act(() => h.result.current.api.nextSentence())
    expect(h.result.current.api.index).toBe(1)
    expect(h.result.current.api.phase).toBe('preview')

    // 第一句再往前：不动
    act(() => h.result.current.api.startDrill(0))
    act(() => h.result.current.api.prevSentence())
    expect(h.result.current.api.index).toBe(0)
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

  it('整句渐进开关：关掉只剩语言点轮，打开追加词→目标→整句', () => {
    const h = setup()
    act(() => h.result.current.api.openGolden())
    act(() => h.result.current.api.startDrill())
    act(() => h.result.current.api.setBlankUnit('target'))
    act(() => h.result.current.api.setSentenceFill(false))
    act(() => h.result.current.api.beginFill())
    expect(h.result.current.api.fillRoundCount).toBe(1)
    act(() => h.result.current.api.setSentenceFill(true))
    expect(h.result.current.api.fillRoundCount).toBeGreaterThan(1)
    expect(h.result.current.api.sentenceFill).toBe(true)
  })

  it('没完成遣词造句不让进逆向回顾', () => {
    const h = setup()
    act(() => h.result.current.api.openGolden())
    act(() => h.result.current.api.startRecall())
    expect(h.result.current.api.view).toBe('home')
    expect(h.flash).toHaveBeenCalledWith('先完成全部句子的遣词造句，再进逆向回顾')
  })

  it('逆向回顾从队列第一句开始判分，不受学习页当前句影响', () => {
    const doc: ReaderDoc = {
      paragraphs: [{ id: 'p01', sentenceIds: ['s1', 's2'] }],
      sentences: [sentence, sentence2],
    }
    const h = setup(doc, dueRecords(doc))
    act(() => h.result.current.api.openGolden())
    act(() => h.result.current.api.startDrill(1))
    expect(h.result.current.api.currentSentence?.id).toBe('s2')

    act(() => h.result.current.api.startRecall())
    expect(h.result.current.api.currentRecallSentence?.id).toBe('s1')
    act(() => h.result.current.api.setRecallInput(sentence.text))
    act(() => h.result.current.api.checkRecall())
    expect(h.result.current.api.recallChecked?.firstOk).toBe(true)
    expect(h.recordAnswer).toHaveBeenLastCalledWith(expect.objectContaining({ questionId: 's1:recall' }))
  })

  it('待回顾按队列当前句判分，不用学习页的 index 顶替', () => {
    const doc: ReaderDoc = {
      paragraphs: [{ id: 'p01', sentenceIds: ['s1', 's2'] }],
      sentences: [sentence, sentence2],
    }
    const h = setup(doc, dueRecords(doc))
    act(() => h.result.current.api.openGolden())
    act(() => h.result.current.api.startDrill())
    act(() => h.result.current.api.startReview())
    expect(h.result.current.api.reviewCount).toBe(2)
    expect(h.result.current.api.recallList.map((s) => s.id)).toEqual(['s1', 's2'])

    act(() => h.result.current.api.nextRecall())
    expect(h.result.current.api.currentRecallSentence?.id).toBe('s2')
    act(() => h.result.current.api.setRecallInput(sentence2.text))
    act(() => h.result.current.api.checkRecall())
    expect(h.result.current.api.recallChecked?.firstOk).toBe(true)
    expect(h.recordAnswer).toHaveBeenLastCalledWith(expect.objectContaining({ questionId: 's2:recall' }))
  })
})
