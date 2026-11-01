import { describe, it, expect } from 'vitest'
import { studyCardView } from './studyView'
import { createLibrary } from './library'
import { vocabItem } from '../testFixtures'
import type { VocabItem } from '../../types/document'

function libraryWith(items: VocabItem[]) {
  return { ...createLibrary(), items }
}

/** 四个义项各不相同，`canQuizMeaning` 才出得了「正确 + 3 个干扰项」。 */
function quizLibrary(over: Partial<VocabItem> = {}) {
  return libraryWith([
    vocabItem({ id: 'vocab:a', word: 'alpha', meaning: '甲', ...over }),
    vocabItem({ id: 'vocab:b', word: 'beta', meaning: '乙' }),
    vocabItem({ id: 'vocab:c', word: 'gamma', meaning: '丙' }),
    vocabItem({ id: 'vocab:d', word: 'delta', meaning: '丁' }),
  ])
}

describe('studyCardView：当前卡与门禁', () => {
  it('取词库里的最新版本，而不是队列快照', () => {
    const snapshot = vocabItem({ id: 'vocab:a', word: 'old', meaning: '旧' })
    const latest = vocabItem({ id: 'vocab:a', word: 'new', meaning: '新' })
    const view = studyCardView({
      library: libraryWith([latest]),
      queue: [snapshot],
      index: 0,
      roundTotal: 1,
      retrying: false,
      meaningCleared: false,
    })
    expect(view.card?.word).toBe('new')
  })

  it('词库里找不到时退回队列快照', () => {
    const snapshot = vocabItem({ id: 'vocab:a', word: 'snapshot' })
    const view = studyCardView({
      library: libraryWith([]),
      queue: [snapshot],
      index: 0,
      roundTotal: 1,
      retrying: false,
      meaningCleared: false,
    })
    expect(view.card?.word).toBe('snapshot')
  })

  it('组末拼写测试的词优先于队列', () => {
    const view = studyCardView({
      library: libraryWith([vocabItem({ id: 'vocab:a', word: 'queue' })]),
      queue: [vocabItem({ id: 'vocab:a' })],
      index: 0,
      roundTotal: 1,
      retrying: false,
      meaningCleared: false,
      roundCard: vocabItem({ id: 'vocab:round', word: 'round' }),
    })
    expect(view.card?.word).toBe('round')
  })

  it('index 越过 roundTotal 才算加练卡', () => {
    const base = { library: quizLibrary(), queue: [vocabItem({ id: 'vocab:a' })], retrying: false, meaningCleared: false }
    expect(studyCardView({ ...base, index: 1, roundTotal: 1 }).isExtraCard).toBe(true)
    expect(studyCardView({ ...base, index: 0, roundTotal: 1 }).isExtraCard).toBe(false)
    expect(studyCardView({ ...base, index: 3, roundTotal: 0 }).isExtraCard).toBe(false)
  })

  it('重学卡不套「选释义」门禁（它走锤炼门禁）', () => {
    const card = vocabItem({ id: 'vocab:a', reviewState: { ...vocabItem().reviewState, relearn: 1 } })
    const view = studyCardView({
      library: quizLibrary({ reviewState: card.reviewState }),
      queue: [card],
      index: 0,
      roundTotal: 1,
      retrying: false,
      meaningCleared: true,
    })
    expect(view.relearning).toBe(true)
    expect(view.meaningRequired).toBe(false)
  })

  it('标过不认识且没重建记忆 → 先选释义；清掉门禁后放行', () => {
    const card = vocabItem({ id: 'vocab:a', tags: ['不认识'] })
    const base = { library: quizLibrary({ tags: ['不认识'] }), queue: [card], index: 0, roundTotal: 1, retrying: false }
    const pending = studyCardView({ ...base, meaningCleared: false })
    expect(pending.meaningRequired).toBe(true)
    expect(pending.meaningGate).toBe(true)
    expect(studyCardView({ ...base, meaningCleared: true }).meaningGate).toBe(false)
  })

  it('词库出不了四个选项时退回普通卡片，不卡门禁', () => {
    const card = vocabItem({ id: 'vocab:a', tags: ['不认识'] })
    const view = studyCardView({
      library: libraryWith([card]),
      queue: [card],
      index: 0,
      roundTotal: 1,
      retrying: false,
      meaningCleared: false,
    })
    expect(view.meaningRequired).toBe(false)
  })
})
