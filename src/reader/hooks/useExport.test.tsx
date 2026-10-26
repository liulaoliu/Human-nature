// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useExport, type UseExportParams } from './useExport'
import { ARTICLE_PACKAGE_FORMAT } from '../../core/articlePackage'
import { createLibrary, markWord } from '../../core/vocab'
import { TEST_NOW, vocabItem } from '../../core/testFixtures'
import { installFakeStorage } from '../testStorage'
import type { LearningCollections, LearningSetters } from './useLearningData'
import type { ArticleRepoPort, SavedArticle } from '../../core/ports'

/**
 * 备份导入/合并的接线测试。
 * 重点钉住：坏文件不碰现有数据、合并导入同一文件第二次跳过（避免学习时长重复累加）、
 * 打印被拦截时用户能看到提示。领域细节（解析/合并规则）已在 core 单测覆盖，这里只测接线。
 */

const article: SavedArticle = {
  id: 'a1',
  title: 'A',
  sourceKey: 'a1',
  text: 'Hello.',
  paragraphs: [{ id: 'p1', sentenceIds: ['s1'] }],
  sentences: [{ id: 's1', paraId: 'p1', text: 'Hello.' } as SavedArticle['sentences'][number]],
  updatedAt: '2026-10-01T00:00:00.000Z',
}

const backupLibrary = () => markWord(createLibrary(), { word: 'run', articleId: 'a1' }, TEST_NOW).library

const learning: LearningCollections = {
  practice: [],
  mistakes: [],
  activity: [],
  studyDays: [],
  sessions: [],
  studiedDays: [],
  skimmed: [],
  kindStats: {},
  answerEvents: [],
  backTranslations: [],
  retells: [],
  readDone: [],
  readGoal: 2,
  goalMemo: '',
}

const setterNames: (keyof LearningSetters)[] = [
  'setPractice',
  'setMistakes',
  'setActivity',
  'setStudyDays',
  'setSessions',
  'setStudiedDays',
  'setSkimmed',
  'setKindStats',
  'setBackTranslations',
  'setRetells',
  'setReadDone',
  'setReadGoal',
  'setGoalMemo',
]

function setup(over: Partial<UseExportParams> = {}) {
  const save = vi.fn(async () => {})
  const list = vi.fn(async () => [article])
  const articles = { current: { list, get: vi.fn(), save, remove: vi.fn() } as ArticleRepoPort }
  const setters = Object.fromEntries(setterNames.map((k) => [k, vi.fn()])) as unknown as LearningSetters
  const persist = vi.fn()
  const persistNow = vi.fn(async () => {})
  const flash = vi.fn()
  const setSaved = vi.fn()
  const setWritingHistory = vi.fn()
  const { result, unmount } = renderHook(() =>
    useExport({
      articles,
      library: createLibrary(),
      saved: [],
      learning,
      setters,
      writingHistory: [],
      visibleBatch: [],
      persist,
      persistNow,
      flash,
      setSaved,
      setWritingHistory,
      ...over,
    }),
  )
  return { result, unmount, save, list, setters, persist, persistNow, flash, setSaved, setWritingHistory, articles }
}

const fileOf = (text: string) => ({ text: async () => text }) as File

let restoreStorage = () => {}
beforeEach(() => {
  restoreStorage = installFakeStorage()
})
afterEach(() => {
  restoreStorage()
  vi.restoreAllMocks()
})

describe('useExport：导入', () => {
  it('初始态：返回全部导出/导入动作', () => {
    const { result } = setup()
    for (const key of ['download', 'doExportAnki', 'exportJson', 'exportWordList', 'exportBatch', 'doExportWrong', 'exportAll', 'doExportArticlePackage', 'onImportBackup', 'onMergeBackup', 'doPrint'] as const) {
      expect(typeof result.current[key]).toBe('function')
    }
  })

  it('成功：文章写入仓储、词库整库替换、学习记录按段替换、刷新已保存列表', async () => {
    const { result, save, persistNow, setters, setSaved, flash } = setup()
    await act(async () => {
      await result.current.onImportBackup(
        fileOf(JSON.stringify({ articles: [article], library: backupLibrary(), activity: [{ day: '2026-10-01', counts: { read: 1 } }] })),
      )
    })
    expect(save).toHaveBeenCalledWith(article)
    expect(persistNow).toHaveBeenCalledTimes(1)
    expect(setters.setActivity).toHaveBeenCalledWith([{ day: '2026-10-01', counts: { read: 1 } }])
    expect(setSaved).toHaveBeenCalledWith([article])
    expect(flash.mock.calls[0][0]).toContain('导入完成')
  })

  it('失败：不是有效 JSON 只提示，不碰词库/仓储', async () => {
    const { result, save, persistNow, flash } = setup()
    await act(async () => {
      await result.current.onImportBackup(fileOf('not json'))
    })
    expect(save).not.toHaveBeenCalled()
    expect(persistNow).not.toHaveBeenCalled()
    expect(flash).toHaveBeenCalledWith('导入失败：不是有效的 JSON 备份')
  })
})

describe('useExport：合并导入', () => {
  it('成功：词库合并后写回，并记住文件指纹', async () => {
    const { result, persistNow, flash } = setup()
    const file = fileOf(JSON.stringify({ articles: [article], library: backupLibrary() }))
    await act(async () => {
      await result.current.onMergeBackup(file)
    })
    expect(persistNow).toHaveBeenCalledTimes(1)
    expect(flash.mock.calls[0][0]).toContain('合并完成')
  })

  it('同一份文件第二次合并：跳过，不重复累加学习时长', async () => {
    const { result, persistNow, flash } = setup()
    const file = fileOf(JSON.stringify({ articles: [article], library: backupLibrary(), activity: [{ day: '2026-10-01', counts: { read: 1 } }] }))
    await act(async () => {
      await result.current.onMergeBackup(file)
    })
    await act(async () => {
      await result.current.onMergeBackup(file)
    })
    expect(persistNow).toHaveBeenCalledTimes(1)
    expect(flash).toHaveBeenLastCalledWith(expect.stringContaining('已经合并导入过'))
  })

  it('词库落盘失败：不记指纹，同一份文件还能再导一次', async () => {
    let fail = true
    const persistNow = vi.fn(async () => {
      if (fail) throw new Error('409 conflict')
    })
    const { result, flash } = setup({ persistNow })
    const file = fileOf(JSON.stringify({ articles: [article], library: backupLibrary() }))

    await act(async () => {
      await result.current.onMergeBackup(file)
    })
    expect(persistNow).toHaveBeenCalledTimes(1)
    expect(flash).toHaveBeenLastCalledWith(expect.stringContaining('未记导入指纹'))

    fail = false
    await act(async () => {
      await result.current.onMergeBackup(file)
    })
    expect(persistNow).toHaveBeenCalledTimes(2)
    expect(flash.mock.calls.at(-1)?.[0]).toContain('合并完成')
  })

  it('坏文件：提示失败，不写库', async () => {
    const { result, persistNow, flash } = setup()
    await act(async () => {
      await result.current.onMergeBackup(fileOf('{'))
    })
    expect(persistNow).not.toHaveBeenCalled()
    expect(flash).toHaveBeenCalledWith('合并失败：不是有效的 JSON 备份')
  })
})

describe('useExport：文章包', () => {
  it('当前篇没保存：只提示，不下载', () => {
    const { result, flash } = setup()
    result.current.doExportArticlePackage(['nope'])
    expect(flash).toHaveBeenCalledWith(expect.stringContaining('还没保存'))
  })

  it('已保存的篇：导出 JSON（含这篇的词条），并提示用合并导入', () => {
    const create = vi.fn(() => 'blob:test')
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const { result, flash } = setup({ saved: [article], library: backupLibrary() })
    result.current.doExportArticlePackage([article.id])
    expect(create).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(flash).toHaveBeenCalledWith(expect.stringContaining('已导出文章包'))
  })

  it('覆盖导入拿到文章包：拒绝，不碰词库（否则整库只剩这一篇）', async () => {
    const { result, persistNow, flash } = setup()
    await act(async () => {
      await result.current.onImportBackup(
        fileOf(JSON.stringify({ format: ARTICLE_PACKAGE_FORMAT, articles: [article], library: backupLibrary() })),
      )
    })
    expect(persistNow).not.toHaveBeenCalled()
    expect(flash).toHaveBeenCalledWith(expect.stringContaining('文章包'))
  })
})

describe('useExport：打印', () => {
  it('没有词时只提示，不弹窗', () => {
    const open = vi.spyOn(window, 'open')
    const { result, flash } = setup()
    result.current.doPrint([], '标题')
    expect(flash).toHaveBeenCalledWith('没有可打印的词')
    expect(open).not.toHaveBeenCalled()
  })

  it('按行打印多篇：分组标题带每篇条数', () => {
    const write = vi.fn()
    vi.spyOn(window, 'open').mockReturnValue({
      document: { write, close: vi.fn() },
    } as unknown as Window)
    const { result } = setup()
    result.current.doPrintRows(
      [
        { item: vocabItem({ id: 'a1', word: 'alpha', lemma: 'alpha' }), articleId: 'A', articleTitle: 'A 篇', number: 1 },
        { item: vocabItem({ id: 'b1', word: 'beta', lemma: 'beta' }), articleId: 'B', articleTitle: 'B 篇', number: 1 },
        { item: vocabItem({ id: 'b2', word: 'gamma', lemma: 'gamma' }), articleId: 'B', articleTitle: 'B 篇', number: 2 },
      ],
      '词表',
    )
    const html = write.mock.calls[0][0] as string
    expect(html).toContain('<h2>A 篇（1）</h2>')
    expect(html).toContain('<h2>B 篇（2）</h2>')
  })

  it('弹窗被拦截时提示，不写打印时间', () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    const { result, persist, flash } = setup()
    result.current.doPrint([vocabItem({ id: 'w1', word: 'run', lemma: 'run' })], '标题')
    expect(flash).toHaveBeenCalledWith('弹窗被拦截，允许后重试')
    expect(persist).not.toHaveBeenCalled()
  })
})
