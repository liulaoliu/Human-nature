import { describe, expect, it } from 'vitest'
import { normalizeProductionDraft } from './productionDraft'

const draft = {
  version: 1,
  sessionId: 's1',
  articleId: 'A',
  at: '2026-11-01T00:00:00.000Z',
  mode: 'full',
  sessionTopic: '随机',
  prompts: [
    {
      id: 'p1',
      zh: '说明进度',
      goal: '汇报',
      targets: [{ id: 't1', itemId: 'v1', kind: 'word', text: 'run', meaning: '跑' }],
    },
  ],
  index: 0,
  answer: 'draft',
  feedback: null,
  previousFeedback: null,
  hits: [{ id: 't1', kind: 'word', text: 'run', meaning: '跑', used: true }],
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
})
