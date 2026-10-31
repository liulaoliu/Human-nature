import { describe, expect, it } from 'vitest'
import type { AnswerEvent } from './answerEvents'
import type { WritingErrorCard } from './writingErrorReview'
import {
  applyWritingErrorReview,
  dueCardsFromProgress,
  mergeWritingErrorProgress,
  normalizeWritingErrorProgress,
  randomWritingErrorCards,
  reviewableWritingErrorCards,
  setWritingErrorProgressStatus,
  syncWritingErrorProgress,
  unpracticedWritingErrorCards,
  writingErrorProgressFromCard,
  writingErrorProgressFromEvents,
} from './writingErrorProgress'

const NOW = '2026-10-31T12:00:00.000Z'

const card: WritingErrorCard = {
  id: 'errfix:word-spelling|spelling-bureaucracy',
  rule: 'word-spelling',
  type: 'spelling',
  key: 'spelling-bureaucracy',
  original: 'bureacracy',
  suggestion: 'bureaucracy',
  reason: '拼写',
  text: 'I learn bureacracy.',
  recordKey: 'r1',
  at: '2026-10-30T00:00:00.000Z',
  articleId: 'a1',
  sentenceId: 's1',
}

const other: WritingErrorCard = {
  ...card,
  id: 'errfix:tense-choice|tense-choice',
  rule: 'tense-choice',
  type: 'grammar',
  key: 'tense-choice',
  original: 'go',
  suggestion: 'went',
}

describe('writingErrorProgress', () => {
  it('从卡片新建：active、0 次、现在到期', () => {
    const p = writingErrorProgressFromCard(card, NOW)
    expect(p).toMatchObject({ id: card.id, status: 'active', streak: 0, reviews: 0 })
    expect(p.dueAt).toBeUndefined()
  })

  it('答对按 3/7/14/30/60；连对 6 次 mastered', () => {
    let p = applyWritingErrorReview(undefined, card, true, NOW)
    expect(p.dueAt).toBe('2026-11-03T12:00:00.000Z')
    p = applyWritingErrorReview(p, card, true, '2026-11-03T12:00:00.000Z')
    expect(p.dueAt).toBe('2026-11-10T12:00:00.000Z')
    for (let i = 0; i < 4; i++) p = applyWritingErrorReview(p, card, true, p.dueAt!)
    expect(p.status).toBe('mastered')
    expect(p.streak).toBe(6)
    expect(p.dueAt).toBeUndefined()
  })

  it('答错归零，1 天后再来；暂停 / 恢复', () => {
    let p = applyWritingErrorReview(undefined, card, true, NOW)
    p = applyWritingErrorReview(p, card, false, '2026-11-03T12:00:00.000Z')
    expect(p).toMatchObject({ streak: 0, lastCorrect: false, dueAt: '2026-11-04T12:00:00.000Z' })
    p = setWritingErrorProgressStatus(p, card, 'paused', NOW)
    expect(p.status).toBe('paused')
    p = setWritingErrorProgressStatus(p, card, 'active', NOW)
    expect(p).toMatchObject({ status: 'active', streak: 0, dueAt: NOW })
  })

  it('旧 answerEvents 可迁成连续次数', () => {
    const events: AnswerEvent[] = [
      { at: '2026-10-01T00:00:00.000Z', day: '2026-10-01', articleId: 'a1', source: 'golden', kind: 'error-fix', cat: 'write', correct: true, questionId: card.id },
      { at: '2026-10-04T00:00:00.000Z', day: '2026-10-04', articleId: 'a1', source: 'golden', kind: 'error-fix', cat: 'write', correct: true, questionId: card.id },
    ]
    const p = writingErrorProgressFromEvents(card, events, NOW)
    expect(p).toMatchObject({ streak: 2, reviews: 2, lastAt: '2026-10-04T00:00:00.000Z' })
  })

  it('外部数据守卫：坏 rule / id 不一致 / 坏状态丢弃或归 active', () => {
    const rows = normalizeWritingErrorProgress([
      writingErrorProgressFromCard(card, NOW),
      { ...writingErrorProgressFromCard(card, NOW), id: 'errfix:wrong|id' },
      { ...writingErrorProgressFromCard(card, NOW), id: 'errfix:bad|bad', rule: 'bad', key: 'bad' },
      { ...writingErrorProgressFromCard(other, NOW), status: 'weird' },
    ])
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.id === other.id)?.status).toBe('active')
  })

  it('到期队列跳过 paused/mastered；没有进度行仍到期', () => {
    const paused = setWritingErrorProgressStatus(writingErrorProgressFromCard(card, NOW), card, 'paused', NOW)
    const due = dueCardsFromProgress([card, other], [paused], new Date('2026-11-10T00:00:00.000Z'))
    expect(due.map((c) => c.id)).toEqual([other.id])
  })

  it('「练过的不练」只滤掉 reviews / lastAt 有值的卡', () => {
    const practiced = applyWritingErrorReview(undefined, card, true, NOW)
    const legacy = { ...writingErrorProgressFromCard(other, NOW), lastAt: NOW }
    expect(unpracticedWritingErrorCards([card, other], [practiced, legacy]).map((c) => c.id)).toEqual([])
    expect(unpracticedWritingErrorCards([card, other], [practiced])).toEqual([other])
    expect(unpracticedWritingErrorCards([card, other], [])).toEqual([card, other])
  })

  it('随机 / 全部：不看到期，但跳过 paused；随机最多 20 张且不重复', () => {
    const paused = setWritingErrorProgressStatus(writingErrorProgressFromCard(card, NOW), card, 'paused', NOW)
    const mastered = applyWritingErrorReview(undefined, other, true, NOW)
    mastered.status = 'mastered'
    expect(reviewableWritingErrorCards([card, other], [paused, mastered])).toEqual([other])

    const many = Array.from({ length: 25 }, (_, i) => ({ ...other, id: `errfix:test|${i}` }))
    const picked = randomWritingErrorCards(many, 20, () => 0.5)
    expect(picked).toHaveLength(20)
    expect(new Set(picked.map((c) => c.id)).size).toBe(20)
    expect(randomWritingErrorCards([card], 20, () => 0.5)).toEqual([card])
  })

  it('合并取 updatedAt 新的；sync 只补缺不覆盖进度', () => {
    const a = writingErrorProgressFromCard(card, NOW)
    const b = { ...a, updatedAt: '2026-11-01T00:00:00.000Z', reviews: 2, streak: 2 }
    expect(mergeWritingErrorProgress([a], [b])[0].reviews).toBe(2)
    const { next, added } = syncWritingErrorProgress([a], [card, other], NOW)
    expect(added).toBe(1)
    expect(next.find((x) => x.id === card.id)?.updatedAt).toBe(a.updatedAt)
  })
})
