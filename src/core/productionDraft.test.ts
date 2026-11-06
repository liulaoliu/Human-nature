import { describe, expect, it } from 'vitest'
import {
  mergeProductionDraftMaps,
  normalizeProductionDraft,
  normalizeProductionDraftMap,
} from './productionDraft'

const draft = {
  version: 1 as const,
  sessionId: 's1',
  articleId: 'A',
  at: '2026-11-01T00:00:00.000Z',
  mode: 'full' as const,
  sessionTopic: '随机',
  prompts: [
    {
      id: 'p1',
      zh: '说明进度',
      goal: '汇报',
      targets: [{ id: 't1', itemId: 'v1', kind: 'word' as const, text: 'run', meaning: '跑' }],
    },
  ],
  index: 0,
  answer: 'draft',
  feedback: null,
  previousFeedback: null,
  hits: [{ id: 't1', kind: 'word' as const, text: 'run', meaning: '跑', used: true }],
  round: 1,
  notice: '',
}

describe('productionDraft：会话草稿守卫', () => {
  it('合法草稿按文章恢复；坏题/坏命中丢弃', () => {
    const ok = normalizeProductionDraft(draft, 'A')
    expect(ok?.answer).toBe('draft')
    expect(ok?.hits).toHaveLength(1)
    const bad = normalizeProductionDraft(
      {
        ...draft,
        prompts: [{ ...draft.prompts[0], zh: 5 }, { ...draft.prompts[0], id: 'p2' }],
        hits: [{ ...draft.hits[0], used: 'yes' }],
      },
      'A',
    )
    expect(bad?.prompts).toHaveLength(1)
    expect(bad?.hits[0].used).toBe(false)
  })

  it('文章不匹配 / 坏版本 / 没题：不恢复', () => {
    expect(normalizeProductionDraft(draft, 'B')).toBeNull()
    expect(normalizeProductionDraft({ ...draft, version: 2 }, 'A')).toBeNull()
    expect(normalizeProductionDraft({ ...draft, prompts: [] }, 'A')).toBeNull()
  })

  it('多草稿按「文章 + 模式」各存一组；合并导入取较新的一版', () => {
    const other = { ...draft, articleId: 'B', at: '2026-11-02T00:00:00.000Z', answer: 'B draft' }
    const map = normalizeProductionDraftMap({ A: draft, B: other })
    expect(Object.keys(map).sort()).toEqual(['A::full', 'B::full'])
    const merged = mergeProductionDraftMaps(
      { 'A::full': { ...draft, answer: 'old' } },
      { 'A::full': { ...draft, at: '2026-11-03T00:00:00.000Z', answer: 'new' } },
    )
    expect(merged['A::full'].answer).toBe('new')
  })

  it('同一篇文章的不同吃法各留一组，互不覆盖', () => {
    const yogurt = {
      ...draft,
      mode: 'yogurt' as const,
      at: '2026-11-04T00:00:00.000Z',
      answer: 'yogurt draft',
    }
    const map = normalizeProductionDraftMap({ 'A::full': draft, 'A::yogurt': yogurt })
    expect(Object.keys(map).sort()).toEqual(['A::full', 'A::yogurt'])
    expect(map['A::yogurt'].answer).toBe('yogurt draft')
    // 旧版按文章存的 map 也能读进来（键从草稿字段重新推）
    const legacy = normalizeProductionDraftMap({ A: yogurt })
    expect(Object.keys(legacy)).toEqual(['A::yogurt'])
  })
})
