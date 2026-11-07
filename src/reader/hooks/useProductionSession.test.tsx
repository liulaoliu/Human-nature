// @vitest-environment jsdom
import { useState } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLibrary } from '../../core/vocab'
import { sentenceFixture, vocabItem } from '../../core/testFixtures'
import type { WritingRecord } from '../../core/writing'
import type { VocabLibrary } from '../../types/document'
import { installFakeStorage } from '../testStorage'
import { useProductionSession } from './useProductionSession'

const packRaw = JSON.stringify({
  prompts: [{ zh: '跟同事说明你下午会跟进。', goal: '说明进度', targetIds: ['v1|self|word'] }],
})
const topicPackRaw = JSON.stringify({
  prompts: [
    { zh: '解释你为什么迟到了。', goal: '解释原因' },
    { zh: '向同事提出一个请求。', goal: '提出请求' },
    { zh: '表达你对这个安排的不同意见。', goal: '表达不同意见' },
  ],
})
const feedbackRaw = JSON.stringify({
  version: 2,
  scores: [{ dimension: '意思', score: 40, max: 40 }],
  total: 40,
  max: 40,
  issues: [],
  recommendations: [],
  polished: 'I will follow up this afternoon.',
  summary: '表达清楚。',
})

let restore: () => void = () => {}
beforeEach(() => {
  restore = installFakeStorage()
  localStorage.clear()
})

afterEach(() => {
  restore()
})

const library: VocabLibrary = {
  ...createLibrary(),
  items: [
    vocabItem({
      id: 'v1',
      word: 'run',
      lemma: 'run',
      meaning: '跑',
      source: { articleId: 'A', fileName: 'A', sentenceId: null, sentenceText: '' },
    }),
  ],
}

function setup(configured = true) {
  let records: WritingRecord[] = []
  const runAi = vi.fn(async (jobs: { task: string }[]) => ({
    results: [
      {
        id: 'x',
        task: jobs[0].task,
        raw:
          jobs[0].task === 'feedback'
            ? feedbackRaw
            : jobs[0].task === 'production_topic'
              ? topicPackRaw
              : packRaw,
      },
    ],
    failed: [],
    dropped: 0,
  }))
  const flash = vi.fn()
  const recordActivity = vi.fn()
  const hook = renderHook(() => {
    const [writingHistory, setWritingHistory] = useState<WritingRecord[]>([])
    records = writingHistory
    return useProductionSession({
      doc: { paragraphs: [], sentences: [sentenceFixture('s1', 'I run daily.')] },
      library,
      articleIdentity: 'A',
      articleTitle: 'A',
      writingHistory,
      setWritingHistory,
      recordActivity,
      flash,
      runAi: runAi as never,
      aiStatus: async () => configured,
      now: () => new Date('2026-11-05T10:00:00.000Z'),
    })
  })
  return { ...hook, runAi, flash, recordActivity, getRecords: () => records }
}

describe('useProductionSession：出题 → 作答 → 批改 → 重写', () => {
  it('今日计划到期入口会先切 due 范围并自动出题', async () => {
    const h = setup()
    act(() =>
      h.result.current.updateSettings({
        mode: 'full',
        scope: 'due',
        types: ['word'],
        promptCount: 3,
        targetsPerPrompt: 1,
        weakRatio: 0,
      }),
    )
    act(() => h.result.current.openDueProduction())
    await waitFor(() => expect(h.result.current.stage).toBe('playing'))
    expect(h.result.current.settings.scope).toBe('due')
  })

  it('AI 出中文题；作答后批改落 writingHistory，重写后才进下一题', async () => {
    const h = setup()
    act(() => h.result.current.openProduction())
    act(() =>
      h.result.current.updateSettings({
        mode: 'full',
        scope: 'all',
        types: ['word'],
        promptCount: 3,
        targetsPerPrompt: 1,
        weakRatio: 0,
      }),
    )
    await act(async () => {
      await h.result.current.start()
    })
    expect(h.result.current.stage).toBe('playing')
    expect(h.result.current.prompts).toHaveLength(1)
    expect(h.result.current.current?.zh).toContain('跟进')

    act(() => h.result.current.setAnswer('I run daily.'))
    await act(async () => {
      await h.result.current.grade()
    })
    expect(h.result.current.feedback?.total).toBe(40)
    expect(h.result.current.hits[0].used).toBe(true)
    expect(h.getRecords()).toHaveLength(1)
    expect(h.getRecords()[0].source).toBe('production')

    act(() => h.result.current.next())
    expect(h.result.current.stage).toBe('playing')
    expect(h.runAi).toHaveBeenCalledTimes(2)

    act(() => h.result.current.rewrite())
    expect(h.result.current.round).toBe(2)
    act(() => h.result.current.setAnswer('I run every day.'))
    await act(async () => {
      await h.result.current.grade()
    })
    expect(h.getRecords()).toHaveLength(2)

    act(() => h.result.current.next())
    expect(h.result.current.stage).toBe('done')
  })

  it('没配 AI：走复制 / 粘回，不丢用户草稿', async () => {
    const copy = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText: copy } })
    const h = setup(false)
    act(() => h.result.current.openProduction())
    act(() =>
      h.result.current.updateSettings({
        mode: 'full',
        scope: 'all',
        types: ['word'],
        promptCount: 3,
        targetsPerPrompt: 1,
      }),
    )
    await act(async () => {
      await h.result.current.start()
    })
    expect(h.result.current.pasteKind).toBe('pack')
    expect(copy).toHaveBeenCalled()

    act(() => h.result.current.applyPaste(packRaw))
    expect(h.result.current.current?.zh).toContain('跟进')
    act(() => h.result.current.setAnswer('I run daily.'))
    await act(async () => {
      await h.result.current.grade()
    })
    expect(h.result.current.pasteKind).toBe('feedback')
    act(() => h.result.current.applyPaste(feedbackRaw))
    expect(h.getRecords()).toHaveLength(1)
    expect(h.getRecords()[0].text).toBe('I run daily.')
  })

  it('脱脂奶：没写主题不开始', async () => {
    const h = setup()
    act(() =>
      h.result.current.updateSettings({
        mode: 'skim',
        topic: '',
        scope: 'all',
        types: ['word'],
      }),
    )
    await act(async () => {
      await h.result.current.start()
    })
    expect(h.result.current.stage).toBe('setup')
    expect(h.flash).toHaveBeenCalledWith(expect.stringContaining('脱脂奶'))
  })

  it('脱脂奶：有主题时 AI 出纯主题句，不挂目标块', async () => {
    const h = setup()
    act(() =>
      h.result.current.updateSettings({
        mode: 'skim',
        topic: '迟到解释',
        promptCount: 3,
      }),
    )
    await act(async () => {
      await h.result.current.start()
    })
    expect(h.result.current.stage).toBe('playing')
    expect(h.result.current.current?.zh).toContain('迟到')
    expect(h.result.current.current?.targets).toEqual([])
    expect(h.runAi).toHaveBeenCalledWith(
      [expect.objectContaining({ task: 'production_topic' })],
      expect.anything(),
    )
  })

  it('全脂关掉本机词块：AI 随机定主题，不挂目标块', async () => {
    const h = setup()
    act(() =>
      h.result.current.updateSettings({
        mode: 'full',
        fullUseChunks: false,
        promptCount: 3,
      }),
    )
    await act(async () => {
      await h.result.current.start()
    })
    expect(h.result.current.stage).toBe('playing')
    expect(h.result.current.current?.targets).toEqual([])
    expect(h.runAi).toHaveBeenCalledWith(
      [expect.objectContaining({ task: 'production_topic' })],
      expect.anything(),
    )
  })

  it('脱脂奶打开本机词块：和全脂一样带目标块硬校验', async () => {
    const h = setup()
    act(() =>
      h.result.current.updateSettings({
        mode: 'skim',
        topic: '迟到解释',
        skimUseChunks: true,
        types: ['word'],
        promptCount: 3,
        targetsPerPrompt: 1,
        weakRatio: 0,
      }),
    )
    await act(async () => {
      await h.result.current.start()
    })
    expect(h.result.current.stage).toBe('playing')
    expect(h.result.current.current?.targets).toHaveLength(1)
    expect(h.runAi).toHaveBeenCalledWith(
      [expect.objectContaining({ task: 'production_pack' })],
      expect.anything(),
    )
  })

  it('刷新后先回选草料页；点「继续这一组」才恢复当前会话草稿', async () => {
    const h = setup()
    act(() =>
      h.result.current.updateSettings({
        mode: 'full',
        scope: 'all',
        types: ['word'],
        promptCount: 3,
        targetsPerPrompt: 1,
        weakRatio: 0,
      }),
    )
    await act(async () => {
      await h.result.current.start()
    })
    act(() => h.result.current.setAnswer('draft answer'))
    act(() => h.result.current.close())
    h.unmount()

    const restored = setup()
    act(() => restored.result.current.openProduction())
    expect(restored.result.current.stage).toBe('setup')
    const draft = restored.result.current.savedDrafts.find((d) => d.answer === 'draft answer')
    expect(draft).toBeTruthy()
    act(() => restored.result.current.resumeSaved(draft!))
    expect(restored.result.current.stage).toBe('playing')
    expect(restored.result.current.answer).toBe('draft answer')
    expect(restored.result.current.current?.zh).toContain('跟进')

    act(() => restored.result.current.skip())
    expect(restored.result.current.stage).toBe('done')
    expect(restored.getRecords()).toHaveLength(1)
    expect((restored.getRecords()[0].task as { skipped?: boolean }).skipped).toBe(true)
    expect(restored.getRecords()[0].text).toBe('draft answer')
  })

  it('关闭后再次进工棚：即使有未完成任务，也先回选草料页', async () => {
    const h = setup()
    act(() =>
      h.result.current.updateSettings({
        mode: 'full',
        scope: 'all',
        types: ['word'],
        promptCount: 3,
        targetsPerPrompt: 1,
        weakRatio: 0,
      }),
    )
    await act(async () => {
      await h.result.current.start()
    })
    act(() => h.result.current.setAnswer('still here'))
    act(() => h.result.current.close())
    expect(h.result.current.open).toBe(false)

    act(() => h.result.current.openProduction())
    expect(h.result.current.stage).toBe('setup')
    expect(h.result.current.savedDrafts.some((d) => d.answer === 'still here')).toBe(true)
  })

  it('手工纠正目标块命中会写回已保存的一稿', async () => {
    const h = setup()
    act(() =>
      h.result.current.updateSettings({
        mode: 'full',
        scope: 'all',
        types: ['word'],
        promptCount: 3,
        targetsPerPrompt: 1,
        weakRatio: 0,
      }),
    )
    await act(async () => {
      await h.result.current.start()
    })
    act(() => h.result.current.setAnswer('I run daily.'))
    await act(async () => {
      await h.result.current.grade()
    })
    act(() => h.result.current.setHitUsed(h.result.current.hits[0].id, false))
    expect(h.result.current.hits[0].used).toBe(false)
    expect(
      (h.getRecords()[0].task as { hits?: { used: boolean }[] }).hits?.[0].used,
    ).toBe(false)
  })

  it('风味酸奶：英译中方向 + 用户对齐后的句对直接开始', () => {
    const h = setup()
    act(() =>
      h.result.current.updateSettings({
        mode: 'yogurt',
        yogurtDirection: 'en-zh',
        yogurtParagraph: false,
      }),
    )
    act(() =>
      h.result.current.startYogurtPairs([
        { source: 'Hello.', reference: '你好。' },
        { source: 'Goodbye.', reference: '再见。' },
      ]),
    )
    expect(h.result.current.stage).toBe('playing')
    expect(h.result.current.prompts).toHaveLength(2)
    expect(h.result.current.current).toMatchObject({
      zh: 'Hello.',
      reference: '你好。',
      answerLang: 'zh',
    })
  })

  it('风味酸奶：本地拆句，不调 AI 出题；批改时把参考译文作为范句', async () => {
    const h = setup()
    act(() =>
      h.result.current.updateSettings({
        mode: 'yogurt',
        sourceText: '第一句。第二句。',
        referenceText: 'First sentence. Second sentence.',
        yogurtParagraph: false,
      }),
    )
    await act(async () => {
      await h.result.current.start()
    })
    expect(h.result.current.stage).toBe('playing')
    expect(h.result.current.prompts).toHaveLength(2)
    expect(h.result.current.current?.reference).toBe('First sentence.')
    expect(h.runAi).not.toHaveBeenCalled()

    act(() => h.result.current.setAnswer('First sentence.'))
    await act(async () => {
      await h.result.current.grade()
    })
    expect(h.runAi).toHaveBeenCalledTimes(1)
    expect(h.getRecords()).toHaveLength(1)
    expect(h.getRecords()[0].task).toMatchObject({
      mode: 'yogurt',
      reference: 'First sentence.',
    })
  })
})
