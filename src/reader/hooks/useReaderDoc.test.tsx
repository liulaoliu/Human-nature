// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { segment, carryAnalysis } from '../../core/segmenter'
import { cleanText } from '../../core/cleaner'
import type { ArticleBook } from '../../core/matchArticle'
import type { ArticleRepoPort, SavedArticle } from '../../core/ports'
import { installFakeStorage } from '../testStorage'
import { useReaderDoc, type UseReaderDocParams } from './useReaderDoc'

const book: ArticleBook = {
  '009 Leaders - Interest-rate caps': { title: 'Leaders', words: 100, text: 'Built in text.' },
  '005-Leaders---The-green-boom': { title: 'Green', words: 100, text: 'Dashed text.' },
  我的录音: { title: 'Mine', words: 10, text: 'Other text.' },
}

const seg = segment('Hello world. Second sentence.')

function article(over: Partial<SavedArticle> = {}): SavedArticle {
  return {
    id: 'saved:1',
    title: 'Saved',
    sourceKey: null,
    text: 'Saved text.',
    paragraphs: seg.paragraphs,
    sentences: seg.sentences,
    updatedAt: '2026-10-20T00:00:00.000Z',
    ...over,
  }
}

function setup(over: Partial<UseReaderDocParams> = {}) {
  const repo = {
    save: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    remove: vi.fn().mockResolvedValue(undefined),
  } as unknown as ArticleRepoPort
  const params: UseReaderDocParams = {
    articles: { current: repo },
    batchMapRef: { current: {} },
    setBatch: vi.fn(),
    resetSelection: vi.fn(),
    flash: vi.fn(),
    book,
    articleKey: null,
    setArticleKey: vi.fn(),
    doc: null,
    setDoc: vi.fn(),
    articleTitle: '',
    setArticleTitle: vi.fn(),
    saved: [],
    setSaved: vi.fn(),
    savedLoaded: false,
    savedId: null,
    setSavedId: vi.fn(),
    pendingSave: false,
    setPendingSave: vi.fn(),
    sourceText: '',
    setSourceText: vi.fn(),
    setEditing: vi.fn(),
    draft: '',
    setDraft: vi.fn(),
    articleBook: '',
    setArticleBook: vi.fn(),
    confirmDelSave: false,
    setConfirmDelSave: vi.fn(),
    edition: '全部',
    ...over,
  }
  const hook = renderHook(() => useReaderDoc(params))
  const setParams = (patch: Partial<UseReaderDocParams>) => {
    Object.assign(params, patch)
    hook.rerender()
  }
  return { p: params, repo, setParams, ...hook }
}

let restore: () => void = () => {}

beforeEach(() => {
  restore = installFakeStorage()
})

afterEach(() => {
  restore()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useReaderDoc：打开文章', () => {
  it('内置原文：清洗、切句、清选区、恢复该篇待选', () => {
    const pending = [{ word: 'run', sentence: 'Run.', sentenceId: 's1' }]
    const { p, result } = setup({
      batchMapRef: { current: { '009 Leaders - Interest-rate caps': pending } },
    })
    act(() => result.current.loadText('009 Leaders - Interest-rate caps', '  Hello   world. ', 'T', null))

    const cleaned = cleanText('  Hello   world. ')
    expect(p.setDoc).toHaveBeenCalledWith(segment(cleaned))
    expect(p.setSourceText).toHaveBeenCalledWith(cleaned)
    expect(p.setEditing).toHaveBeenCalledWith(false)
    expect(p.resetSelection).toHaveBeenCalled()
    expect(p.setArticleKey).toHaveBeenCalledWith('009 Leaders - Interest-rate caps')
    expect(p.setArticleTitle).toHaveBeenCalledWith('T')
    expect(p.setArticleBook).toHaveBeenCalledWith('')
    expect(p.setSavedId).toHaveBeenCalledWith(null)
    expect(p.setBatch).toHaveBeenCalledWith(pending)
  })

  it('已保存文章：直接用存下来的切句，不重新切；记住上次打开', () => {
    const a = article({ text: '', id: 'saved:9', title: 'Old' })
    const { p, result } = setup()
    act(() => result.current.loadSaved(a))

    expect(p.setDoc).toHaveBeenCalledWith({ paragraphs: a.paragraphs, sentences: a.sentences })
    // 老记录没存 text → 从段落/句子还原
    expect(p.setSourceText).toHaveBeenCalledWith('Hello world. Second sentence.')
    expect(p.setSavedId).toHaveBeenCalledWith('saved:9')
    expect(JSON.parse(localStorage.getItem('reader:last') ?? 'null')).toEqual({ key: null, id: 'saved:9' })
  })

  it('从内置原文打开：有保存版本优先用保存的', () => {
    const existing = article({ id: 'saved:5', sourceKey: '009 Leaders - Interest-rate caps', title: 'Edited' })
    const { p, result } = setup({ saved: [existing] })
    act(() => result.current.loadFromBook('009 Leaders - Interest-rate caps'))

    expect(p.setDoc).toHaveBeenCalledWith({ paragraphs: existing.paragraphs, sentences: existing.sentences })
    expect(p.setArticleTitle).toHaveBeenCalledWith('Edited')
  })

  it('从内置原文打开：没保存过用原文库；查不到则不动', () => {
    const { p, result } = setup()
    act(() => result.current.loadFromBook('我的录音'))
    expect(p.setDoc).toHaveBeenCalledWith(segment(cleanText('Other text.')))
    expect(p.setArticleTitle).toHaveBeenCalledWith('Mine')

    vi.mocked(p.setDoc).mockClear()
    act(() => result.current.loadFromBook('不存在'))
    expect(p.setDoc).not.toHaveBeenCalled()
  })

  it('onPick 按前缀分流；无效值忽略', () => {
    const a = article({ id: 'saved:7' })
    const { p, result } = setup({ saved: [a] })
    act(() => result.current.onPick('b:我的录音'))
    expect(p.setDoc).toHaveBeenCalledTimes(1)

    act(() => result.current.onPick('s:saved:7'))
    expect(p.setDoc).toHaveBeenCalledTimes(2)

    act(() => result.current.onPick('unknown'))
    expect(p.setDoc).toHaveBeenCalledTimes(2)
  })
})

describe('useReaderDoc：保存 / 删除 / 改名', () => {
  it('没文档不保存；新文档需要命名并落盘', async () => {
    const { p, repo, result } = setup()
    await act(async () => result.current.saveCurrent())
    expect(repo.save).not.toHaveBeenCalled()
    expect(p.flash).toHaveBeenCalledWith('先打开或粘一篇文章')

    vi.spyOn(window, 'prompt').mockReturnValue('My title')
    const saved = setup({ doc: seg, sourceText: 'Hello world. Second sentence.', articleKey: 'k1' })
    await act(async () => saved.result.current.saveCurrent())
    expect(window.prompt).toHaveBeenCalled()
    expect(saved.repo.save).toHaveBeenCalledTimes(1)
    const a = vi.mocked(saved.repo.save).mock.calls[0][0]
    expect(a).toMatchObject({ id: 'saved:k1', title: 'My title', sourceKey: 'k1', text: 'Hello world. Second sentence.' })
    expect(saved.p.setSavedId).toHaveBeenCalledWith('saved:k1')
    expect(saved.p.flash).toHaveBeenCalledWith('已保存到本机')
  })

  it('已有 savedId：不再问标题，原 id 覆盖保存', async () => {
    vi.spyOn(window, 'prompt')
    const { p, repo, result } = setup({
      doc: seg,
      savedId: 'saved:1',
      articleTitle: 'Keep',
      sourceText: 'x',
    })
    await act(async () => result.current.saveCurrent())
    expect(window.prompt).not.toHaveBeenCalled()
    expect(vi.mocked(repo.save).mock.calls[0][0]).toMatchObject({ id: 'saved:1', title: 'Keep' })
    expect(p.setArticleTitle).toHaveBeenCalledWith('Keep')
  })

  it('保存失败：提示且不进入已保存态', async () => {
    const { p, repo, result } = setup({
      doc: seg,
      savedId: 'saved:1',
      articleTitle: 'A',
      sourceText: 'x',
    })
    vi.mocked(repo.save).mockRejectedValueOnce(new Error('quota'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await act(async () => result.current.saveCurrent())
    expect(p.setSavedId).not.toHaveBeenCalled()
    expect(p.flash).toHaveBeenCalledWith('保存文章失败：请稍后重试，或先导出全文')
  })

  it('删除：两步确认才真正删', async () => {
    const { p, repo, result } = setup({ savedId: 'saved:1' })
    act(() => result.current.askDeleteSave())
    expect(p.setConfirmDelSave).toHaveBeenCalledWith(true)
    expect(repo.remove).not.toHaveBeenCalled()

    const second = setup({ savedId: 'saved:1', confirmDelSave: true })
    await act(async () => second.result.current.askDeleteSave())
    expect(second.repo.remove).toHaveBeenCalledWith('saved:1')
    expect(second.p.setConfirmDelSave).toHaveBeenCalledWith(false)
    expect(second.p.setSavedId).toHaveBeenCalledWith(null)
    expect(second.p.flash).toHaveBeenCalledWith('已删除保存；正文还在，可重新保存')
  })

  it('改名：取消 / 空标题不动；保存过的同步写库', async () => {
    const { p, result } = setup({ doc: seg, articleTitle: 'Old' })
    const prompt = vi.spyOn(window, 'prompt').mockReturnValueOnce(null)
    await act(async () => result.current.renameArticle())
    expect(p.setArticleTitle).not.toHaveBeenCalled()

    prompt.mockReturnValueOnce('   ')
    await act(async () => result.current.renameArticle())
    expect(p.setArticleTitle).not.toHaveBeenCalled()

    const withSaved = setup({
      doc: seg,
      articleTitle: 'Old',
      savedId: 'saved:1',
      articleKey: 'k1',
      sourceText: 'x',
    })
    prompt.mockReturnValueOnce('New')
    await act(async () => withSaved.result.current.renameArticle())
    expect(withSaved.p.setArticleTitle).toHaveBeenCalledWith('New')
    expect(vi.mocked(withSaved.repo.save).mock.calls[0][0]).toMatchObject({ id: 'saved:1', title: 'New', sourceKey: 'k1' })
    expect(withSaved.p.flash).toHaveBeenCalledWith('已修改标题')
  })
})

describe('useReaderDoc：编辑正文', () => {
  it('没文档不能进编辑；进入时带出当前正文', () => {
    const none = setup()
    act(() => none.result.current.enterEdit())
    expect(none.p.setEditing).not.toHaveBeenCalled()

    const { p, result } = setup({ doc: seg, sourceText: 'Hello world. Second sentence.' })
    act(() => result.current.enterEdit())
    expect(p.setDraft).toHaveBeenCalledWith('Hello world. Second sentence.')
    expect(p.setEditing).toHaveBeenCalledWith(true)
  })

  it('应用修改：重新切句并按句保留已粘回的分析，触发落盘', () => {
    const withAnalysis = segment('Hello world. Second sentence.')
    withAnalysis.sentences[0].translation = '你好'
    withAnalysis.sentences[0].language = { structure: 'SV' }
    const { p, result } = setup({ doc: withAnalysis, draft: 'Hello world. Second sentence. New line.' })
    act(() => result.current.applyEdit())

    const cleaned = cleanText('Hello world. Second sentence. New line.')
    const next = segment(cleaned)
    const expected = carryAnalysis(withAnalysis.sentences, next.sentences)
    expect(p.setDoc).toHaveBeenCalledWith({ paragraphs: next.paragraphs, sentences: expected })
    expect(expected[0].translation).toBe('你好')
    expect(p.setSourceText).toHaveBeenCalledWith(cleaned)
    expect(p.setPendingSave).toHaveBeenCalledWith(true)
    expect(p.flash).toHaveBeenCalledWith('已应用修改（已粘回的分析按句保留）')
  })

  it('取消编辑只关编辑态', () => {
    const { p, result } = setup()
    act(() => result.current.cancelEdit())
    expect(p.setEditing).toHaveBeenCalledWith(false)
  })
})

describe('useReaderDoc：副作用', () => {
  it('保存过的文章改动后 900ms 自动落盘', () => {
    vi.useFakeTimers()
    const { repo } = setup({ doc: seg, savedId: 'saved:1', articleTitle: 'A', sourceText: 'x' })
    act(() => {
      vi.advanceTimersByTime(899)
    })
    expect(repo.save).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(2)
    })
    expect(repo.save).toHaveBeenCalledTimes(1)
  })

  it('pendingSave：没有保存记录也会立刻建一条', async () => {
    const { repo, setParams } = setup({ doc: seg, sourceText: 'x', articleTitle: 'A' })
    expect(repo.save).not.toHaveBeenCalled()
    await act(async () => {
      setParams({ pendingSave: true })
    })
    expect(repo.save).toHaveBeenCalledTimes(1)
  })

  it('启动恢复：等已保存列表到位；恢复后不再重复替换当前文章', () => {
    localStorage.setItem('reader:last', JSON.stringify({ key: null, id: 'saved:1' }))
    const a = article({ id: 'saved:1' })
    const { p, setParams } = setup({ saved: [a], savedLoaded: false })
    expect(p.setDoc).not.toHaveBeenCalled()

    setParams({ savedLoaded: true })
    expect(p.setDoc).toHaveBeenCalledWith({ paragraphs: a.paragraphs, sentences: a.sentences })

    // 之后列表变化不会再把用户正在看的文章替换掉
    vi.mocked(p.setDoc).mockClear()
    setParams({ saved: [article({ id: 'saved:2' })] })
    expect(p.setDoc).not.toHaveBeenCalled()
  })

  it('启动恢复：内置文章要等原文库到位', () => {
    localStorage.setItem('reader:last', JSON.stringify({ key: '我的录音', id: null }))
    const { p, setParams } = setup({ book: null, savedLoaded: true })
    expect(p.setDoc).not.toHaveBeenCalled()

    setParams({ book })
    expect(p.setDoc).toHaveBeenCalledWith(segment(cleanText('Other text.')))
  })

  it('启动恢复：localStorage 坏数据当作没记录', () => {
    localStorage.setItem('reader:last', '{oops')
    const { p } = setup({ savedLoaded: true })
    expect(p.setDoc).not.toHaveBeenCalled()
  })
})

describe('useReaderDoc：派生列表', () => {
  it('书分组按期次标注；筛选按 edition', () => {
    const { result } = setup()
    expect(result.current.bookKeys).toEqual([
      '005-Leaders---The-green-boom',
      '009 Leaders - Interest-rate caps',
      '我的录音',
    ])
    expect(result.current.editions).toEqual([
      ['2021-06-12', 1],
      ['2016-09-10', 1],
      ['其它', 1],
    ])
    expect(result.current.shownKeys).toHaveLength(3)
  })

  it('指定期次只显示该期', () => {
    const { result } = setup({ edition: '2016-09-10' })
    expect(result.current.shownKeys).toEqual(['009 Leaders - Interest-rate caps'])
  })

  it('没有原文库时列表为空', () => {
    const { result } = setup({ book: null })
    expect(result.current.bookKeys).toEqual([])
    expect(result.current.editions).toEqual([])
    expect(result.current.shownKeys).toEqual([])
  })
})
