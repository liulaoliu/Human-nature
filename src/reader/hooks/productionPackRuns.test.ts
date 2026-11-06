import { describe, expect, it, vi } from 'vitest'
import { createLibrary } from '../../core/vocab'
import { TEST_NOW, vocabItem } from '../../core/testFixtures'
import {
  DEFAULT_PRODUCTION_SETTINGS,
  PRODUCTION_DUE_DAILY_CAP,
  type ProductionSettings,
  type ProductionTarget,
  type ProductionTargetKind,
} from '../../core/production'
import {
  buildTargetPackPlan,
  buildTopicPackPlan,
  runTargetPack,
  runTopicPack,
} from './productionPackRuns'

function libraryWith(n: number) {
  return {
    ...createLibrary(),
    items: Array.from({ length: n }, (_, i) =>
      vocabItem({
        id: `v${i + 1}`,
        word: `word${i + 1}`,
        lemma: `word${i + 1}`,
        meaning: `词${i + 1}`,
        source: { articleId: 'A', fileName: 'A', sentenceId: null, sentenceText: '' },
      }),
    ),
  }
}

function settings(over: Partial<ProductionSettings> = {}): ProductionSettings {
  return {
    ...DEFAULT_PRODUCTION_SETTINGS,
    mode: 'full',
    scope: 'all',
    types: ['word'] as ProductionTargetKind[],
    promptCount: 2,
    targetsPerPrompt: 2,
    weakRatio: 0,
    ...over,
  }
}

const target = (id: string, text: string): ProductionTarget => ({
  id,
  itemId: `item-${id}`,
  kind: 'word',
  text,
  meaning: `${text} 的意思`,
})

function targetPackRaw(ids: string[][], withModel = false): string {
  return JSON.stringify({
    prompts: ids.map((targetIds, i) => ({
      zh: `情境 ${i + 1}`,
      goal: `目标 ${i + 1}`,
      targetIds,
      ...(withModel ? { model: `Model sentence ${i + 1}.` } : {}),
    })),
  })
}

describe('productionPackRuns：出题包计划', () => {
  it('到期范围按每日上限截断题数，不按设置的 5 道硬出', () => {
    const planned = buildTargetPackPlan({
      settings: settings({ scope: 'due', promptCount: 5, targetsPerPrompt: 2 }),
      doc: null,
      library: libraryWith(10),
      articleIdentity: 'A',
      articleTitle: 'A',
      progress: [],
      now: () => TEST_NOW,
    })
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.plan.pool.targets).toHaveLength(PRODUCTION_DUE_DAILY_CAP)
    expect(planned.plan.count).toBe(3)
    expect(planned.plan.shortNotice).toBe('')
  })

  it('候选不够时收窄题数并给出 shortNotice', () => {
    const planned = buildTargetPackPlan({
      settings: settings({ promptCount: 3, targetsPerPrompt: 2 }),
      doc: null,
      library: libraryWith(5),
      articleIdentity: 'A',
      articleTitle: 'A',
      progress: [],
      now: () => TEST_NOW,
    })
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.plan.count).toBe(2)
    expect(planned.plan.per).toBe(2)
    expect(planned.plan.shortNotice).toContain('可用目标块只有 5 个')
  })

  it('一种目标块类型都没选时直接失败', () => {
    const planned = buildTargetPackPlan({
      settings: settings({ types: [] }),
      doc: null,
      library: libraryWith(5),
      articleIdentity: 'A',
      articleTitle: 'A',
      progress: [],
      now: () => TEST_NOW,
    })
    expect(planned).toEqual({ ok: false, message: '至少选一种目标块类型' })
  })

  it('纯主题包保留设置里的题数上限', () => {
    const plan = buildTopicPackPlan(settings({ mode: 'skim', topic: '迟到', promptCount: 4 }), 'A')
    expect(plan.count).toBe(4)
    expect(plan.topic).toBe('迟到')
  })
})

describe('productionPackRuns：AI 出题', () => {
  it('纯主题包多给的题会被截到 count，不因多出而判不合格', async () => {
    const callAi = vi.fn(async () =>
      JSON.stringify({
        prompts: [
          { zh: '一', goal: 'g1' },
          { zh: '二', goal: 'g2' },
          { zh: '三', goal: 'g3' },
        ],
      }),
    )
    const result = await runTopicPack('prompt', 2, callAi)
    expect(result.retried).toBe(false)
    expect(result.prompts).toHaveLength(2)
    expect(callAi).toHaveBeenCalledTimes(1)
  })

  it('纯主题包不合格时自动重试一次，仍不合格就放弃并保留原因', async () => {
    const bad = vi.fn(async () => JSON.stringify({ prompts: [] }))
    const failed = await runTopicPack('prompt', 2, bad)
    expect(bad).toHaveBeenCalledTimes(2)
    expect(failed.retried).toBe(true)
    expect(failed.prompts).toBeUndefined()
    expect(failed.error).toContain('AI 没有返回可用的题目')

    const good = JSON.stringify({ prompts: [{ zh: '一', goal: 'g1' }, { zh: '二', goal: 'g2' }] })
    const retry = vi.fn().mockResolvedValueOnce('').mockResolvedValueOnce(good)
    const passed = await runTopicPack('prompt', 2, retry)
    expect(passed.retried).toBe(true)
    expect(passed.prompts).toHaveLength(2)
    expect(retry.mock.calls[1][1]).toContain('上次输出不合格')
  })

  it('目标块包数量不对时重试，第二次合格才交给会话', async () => {
    const pool = { targets: [target('t1', 'run'), target('t2', 'walk')], total: 2, weak: 0 }
    const callAi = vi
      .fn()
      .mockResolvedValueOnce(targetPackRaw([['t1']]))
      .mockResolvedValueOnce(targetPackRaw([['t1'], ['t2']]))
    const result = await runTargetPack({
      prompt: 'prompt',
      pool,
      count: 2,
      per: 1,
      requireModel: false,
      callAi,
    })
    expect(result.retried).toBe(true)
    expect(result.prompts).toHaveLength(2)
    expect(callAi.mock.calls[1][1]).toContain('上次输出不合格')
  })

  it('目标块包两次都不合 schema 就放弃', async () => {
    const pool = { targets: [target('t1', 'run')], total: 1, weak: 0 }
    const callAi = vi.fn(async () => JSON.stringify({ prompts: [{ zh: '没有目标块', goal: 'g' }] }))
    const result = await runTargetPack({
      prompt: 'prompt',
      pool,
      count: 1,
      per: 1,
      requireModel: false,
      callAi,
    })
    expect(callAi).toHaveBeenCalledTimes(2)
    expect(result.retried).toBe(true)
    expect(result.prompts).toBeUndefined()
    expect(result.error).toContain('AI 没有返回可用的题目')
  })

  it('要求 model 时缺英文参考句会被判不合格', async () => {
    const pool = { targets: [target('t1', 'run')], total: 1, weak: 0 }
    const missingModel = targetPackRaw([['t1']])
    const withModel = targetPackRaw([['t1']], true)
    const callAi = vi.fn().mockResolvedValueOnce(missingModel).mockResolvedValueOnce(withModel)
    const result = await runTargetPack({
      prompt: 'prompt',
      pool,
      count: 1,
      per: 1,
      requireModel: true,
      callAi,
    })
    expect(result.retried).toBe(true)
    expect(result.prompts?.[0].model).toBe('Model sentence 1.')
  })
})
