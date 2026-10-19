// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import type { ChangeEvent } from 'react'
import { useAiPack, type UseAiPackParams } from './useAiPack'
import { installFakeStorage } from '../testStorage'
import type { AiJobsInput } from '../../core/aiPackage'

/**
 * AI 工作包 hook 的接线：服务端 key 探测、空待办提示、导出文件、坏结果文件提示。
 * 任务生成/解析规则在 core/aiPackage 已有表驱动单测，这里只测 hook 的动作接线。
 */
let api: ReturnType<typeof useAiPack> | null = null

const download = vi.fn()
const flash = vi.fn()
const onReport = vi.fn()
const applyTaskResult = vi.fn(() => ({ report: ['ok'], ok: true }))

const input = (over: Partial<AiJobsInput> = {}): AiJobsInput => ({
  batch: [],
  items: [],
  articleWords: [],
  scope: 'all',
  confusableBatchSize: 0,
  sentences: [],
  vocabLevel: 'cet6',
  articleId: 'art-1',
  hasListenQuiz: false,
  listenCount: 8,
  ...over,
})

function Harness({ jobsInput = input() }: { jobsInput?: AiJobsInput }) {
  const params: UseAiPackParams = { jobsInput, applyTaskResult, download, flash, onReport }
  api = useAiPack(params)
  return null
}

/** 挂载并把 `/api/ai/status` 的异步结果冲干净，避免 act 警告。 */
async function mount(jobsInput?: AiJobsInput) {
  await act(async () => {
    render(<Harness jobsInput={jobsInput} />)
    await Promise.resolve()
    await Promise.resolve()
  })
}

let restoreStorage: () => void = () => {}

beforeEach(() => {
  restoreStorage = installFakeStorage()
  api = null
  vi.clearAllMocks()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ configured: true }) })),
  )
})

afterEach(() => {
  restoreStorage()
  vi.unstubAllGlobals()
})

describe('useAiPack：状态与空待办', () => {
  it('初始态：探测服务端是否配了 key', async () => {
    await mount()
    expect(api!.localConfigured).toBe(true)
  })

  it('探测失败：当作未配置，不卡住界面', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('offline'))
    await mount()
    expect(api!.localConfigured).toBe(false)
  })

  it('空待办：导出与复制都只提示，不产生文件', async () => {
    await mount()
    act(() => api!.exportJobs())
    expect(flash).toHaveBeenCalledWith(expect.stringContaining('没有待办'))
    expect(download).not.toHaveBeenCalled()
    expect(api!.webTotal).toBe(0)
  })
})

describe('useAiPack：导出与导入', () => {
  it('有待办时导出 JSON，并记住包内容供结果导入使用', async () => {
    await mount(input({ batch: [{ word: 'alpha', sentence: 'A.' }] }))
    expect(api!.jobCount).toBeGreaterThan(0)
    act(() => api!.exportJobs())
    expect(download).toHaveBeenCalledTimes(1)
    const [name, content, mime] = download.mock.calls[0]
    expect(name).toMatch(/^ai-jobs-\d{4}-\d{2}-\d{2}\.json$/)
    expect(mime).toBe('application/json')
    expect(JSON.parse(content).jobs.length).toBeGreaterThan(0)
    expect(flash).toHaveBeenCalledWith(expect.stringContaining('已导出'))
  })

  it('坏结果文件：提示导入失败，不清空/应用任何东西', async () => {
    await mount(input({ batch: [{ word: 'alpha', sentence: 'A.' }] }))
    const file = { text: async () => 'not json' } as File
    const event = { target: { files: [file], value: 'x' } } as unknown as ChangeEvent<HTMLInputElement>
    act(() => api!.onFile(event))
    await waitFor(() => expect(flash).toHaveBeenCalledWith(expect.stringContaining('导入失败')))
    expect(applyTaskResult).not.toHaveBeenCalled()
  })

  it('网页版粘贴：解析不到结果时只提示，不推进进度', async () => {
    await mount(input({ batch: [{ word: 'alpha', sentence: 'A.' }] }))
    let ok = true
    act(() => {
      ok = api!.applyWeb('随便一段没有答案标记的回复')
    })
    expect(ok).toBe(false)
    expect(flash).toHaveBeenCalledWith('没解析出结果')
    expect(onReport).toHaveBeenCalledWith([expect.stringContaining('没解析出结果')])
  })
})
