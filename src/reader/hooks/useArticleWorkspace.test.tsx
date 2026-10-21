// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { sentenceFixture } from '../../core/testFixtures'
import { useArticleWorkspace } from './useArticleWorkspace'

const mocks = vi.hoisted(() => ({
  loadSaved: vi.fn(),
  renameArticle: vi.fn(),
  copyCleanupPrompt: vi.fn(),
  createArticle: vi.fn(),
  onImportFiles: vi.fn(),
  onPickPdf: vi.fn(),
  onPickEpub: vi.fn(),
}))

vi.mock('./useReaderDoc', () => ({
  useReaderDoc: () => ({ loadSaved: mocks.loadSaved, renameArticle: mocks.renameArticle, autoSaved: true }),
}))
vi.mock('./useArticleImport', () => ({
  useArticleImport: () => ({
    copyCleanupPrompt: mocks.copyCleanupPrompt,
    createArticle: mocks.createArticle,
    onImportFiles: mocks.onImportFiles,
    onPickPdf: mocks.onPickPdf,
    onPickEpub: mocks.onPickEpub,
    markPaste: vi.fn(),
  }),
}))

function setup(over: Record<string, unknown> = {}) {
  const setDoc = vi.fn()
  const flash = vi.fn()
  const params = {
    articles: { current: null },
    batchMapRef: { current: {} },
    setBatch: vi.fn(),
    resetSelection: vi.fn(),
    flash,
    book: null,
    articleKey: null,
    setArticleKey: vi.fn(),
    articleTitle: '',
    setArticleTitle: vi.fn(),
    savedId: null,
    setSavedId: vi.fn(),
    confirmDelSave: false,
    setConfirmDelSave: vi.fn(),
    doc: { paragraphs: [], sentences: [sentenceFixture('s1')] },
    setDoc,
    saved: [],
    setSaved: vi.fn(),
    savedLoaded: true,
    ...over,
  }
  const hook = renderHook(() => useArticleWorkspace(params))
  return { ...hook, setDoc, flash }
}

describe('useArticleWorkspace：文档与导入状态', () => {
  it('初始态：空白文章、未进入新建、无编辑草稿', () => {
    const { result } = setup()
    expect(result.current.articleTitle).toBe('')
    expect(result.current.currentValue).toBe('')
    expect(result.current.composing).toBe(false)
    expect(result.current.langOpen).toBe(false)
    expect(result.current.docApi).toMatchObject({ autoSaved: true })
  })

  it('当前值优先用 savedId，其次内置 book key', () => {
    const { result, rerender } = setup()
    act(() => result.current.setComposing(true))
    expect(result.current.composing).toBe(true)
    rerender()
    expect(result.current.currentValue).toBe('')
  })

  it('新建 / 编辑态由 hook 自己持有，setter 可改', () => {
    const { result } = setup()
    act(() => {
      result.current.setNewTitle('标题')
      result.current.setManual('正文')
      result.current.setDraft('草稿')
    })
    expect(result.current.newTitle).toBe('标题')
    expect(result.current.manual).toBe('正文')
    expect(result.current.editing).toBe(false)
    expect(result.current.draft).toBe('草稿')
  })
})

describe('useArticleWorkspace：语言点编辑', () => {
  it('openLangFor(null) 不动作；有句子则记目标并开面板', () => {
    const { result } = setup()
    act(() => result.current.openLangFor(null))
    expect(result.current.langOpen).toBe(false)
    expect(result.current.langTarget).toBeNull()

    const s = sentenceFixture('s1')
    act(() => result.current.openLangFor(s))
    expect(result.current.langOpen).toBe(true)
    expect(result.current.langTarget).toBe(s)
  })

  it('saveLanguage 写回目标句、标记待保存、关面板并提示', () => {
    const s = sentenceFixture('s1', 'Hello.', { language: { grammar: '旧' } })
    const { result, setDoc, flash } = setup({ doc: { paragraphs: [], sentences: [s] } })
    act(() => result.current.openLangFor(s))
    act(() => result.current.saveLanguage([{ grammar: '新语法', source: 'manual' }]))

    expect(setDoc).toHaveBeenCalledOnce()
    const updater = setDoc.mock.calls[0][0] as (d: { paragraphs: unknown[]; sentences: typeof s[] }) => typeof s extends never ? never : { paragraphs: unknown[]; sentences: typeof s[] }
    const next = updater({ paragraphs: [], sentences: [s] })
    expect(next.sentences[0].languages).toEqual([{ grammar: '新语法', source: 'manual' }])
    expect(next.sentences[0].language).toBeUndefined()
    expect(result.current.langOpen).toBe(false)
    expect(flash).toHaveBeenCalledWith('已保存语言点（1 条）')
  })

  it('空列表保存：提示已清空', () => {
    const s = sentenceFixture('s1')
    const { result, flash } = setup({ doc: { paragraphs: [], sentences: [s] } })
    act(() => result.current.openLangFor(s))
    act(() => result.current.saveLanguage([]))
    expect(flash).toHaveBeenCalledWith('已清空该句语言点')
  })
})
