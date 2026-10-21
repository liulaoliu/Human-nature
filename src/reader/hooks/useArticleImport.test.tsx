// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { extractEpub, extractPdfText } from '../importers'
import type { ArticleRepoPort, SavedArticle } from '../../core/ports'
import { useArticleImport, type UseArticleImportParams } from './useArticleImport'

vi.mock('../importers', () => ({
  extractEpub: vi.fn(),
  extractPdfText: vi.fn(),
}))

const epub = vi.mocked(extractEpub)
const pdf = vi.mocked(extractPdfText)

function fileList(files: File[]): FileList {
  return {
    ...files,
    length: files.length,
    item: (i: number) => files[i] ?? null,
    [Symbol.iterator]: () => files[Symbol.iterator](),
  } as unknown as FileList
}

function setup(over: Partial<UseArticleImportParams> = {}) {
  const saved: SavedArticle[] = [
    { id: 'saved:1', title: '旧文', sourceKey: null, text: 'old', paragraphs: [], sentences: [], updatedAt: '' },
  ]
  const repo = {
    save: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue(saved),
  } as unknown as ArticleRepoPort
  const p: UseArticleImportParams = {
    repo: { current: repo },
    setSaved: vi.fn(),
    loadSaved: vi.fn(),
    newBook: 'Book',
    pdfRange: '1-3',
    manual: '',
    newTitle: '',
    setManual: vi.fn(),
    setNewTitle: vi.fn(),
    setNewBook: vi.fn(),
    setComposing: vi.fn(),
    setImporting: vi.fn(),
    flash: vi.fn(),
    ...over,
  }
  return { p, repo, ...renderHook(() => useArticleImport(p)) }
}

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useArticleImport：清洗提示词', () => {
  it('空文本不复制；成功提示后续动作', async () => {
    const { p, result } = setup()
    await act(async () => result.current.copyCleanupPrompt('   ', '创建'))
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()

    await act(async () => result.current.copyCleanupPrompt('bad text', '创建文章'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('bad text'))
    expect(p.flash).toHaveBeenCalledWith('已复制；去 AI 粘贴，把结果贴回来再创建文章')
  })

  it('剪贴板不可用（非 https）给提示', async () => {
    const { p, result } = setup()
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'))
    await act(async () => result.current.copyCleanupPrompt('text', '创建'))
    expect(p.flash).toHaveBeenCalledWith('复制失败：浏览器需要 localhost 或 https')
  })
})

describe('useArticleImport：新建文章', () => {
  it('空正文不动作', async () => {
    const { p, repo, result } = setup()
    await act(async () => result.current.createArticle())
    expect(repo.save).not.toHaveBeenCalled()
    expect(p.flash).not.toHaveBeenCalled()
  })

  it('清洗切句后保存、刷新列表、载入并清空表单', async () => {
    const { p, repo, result } = setup({ manual: 'Hello world.\nSecond line.', newTitle: '  My  ' })
    await act(async () => result.current.createArticle())

    expect(repo.save).toHaveBeenCalledTimes(1)
    const article = vi.mocked(repo.save).mock.calls[0][0]
    expect(article.title).toBe('My')
    expect(article.book).toBe('Book')
    expect(article.origin).toBe('paste')
    expect(article.sentences.length).toBeGreaterThan(0)
    expect(p.setSaved).toHaveBeenCalled()
    expect(p.loadSaved).toHaveBeenCalledWith(article)
    expect(p.setComposing).toHaveBeenCalledWith(false)
    expect(p.setManual).toHaveBeenCalledWith('')
    expect(p.setNewTitle).toHaveBeenCalledWith('')
    expect(p.setNewBook).toHaveBeenCalledWith('')
    expect(p.flash).toHaveBeenCalledWith('已新建文章')
  })

  it('没写标题用「未命名」', async () => {
    const { repo, result } = setup({ manual: 'Hello.' })
    await act(async () => result.current.createArticle())
    expect(vi.mocked(repo.save).mock.calls[0][0].title).toBe('未命名')
  })
})

describe('useArticleImport：txt/md 导入', () => {
  it('单文件：填 composer 等确认，确认后来源记 file', async () => {
    const { p, repo, result } = setup({ manual: 'Hello there.' })
    await act(async () =>
      result.current.onImportFiles(fileList([new File(['Hello there.'], 'my-note.md')])),
    )
    expect(p.setManual).toHaveBeenCalledWith('Hello there.')
    expect(p.setNewTitle).toHaveBeenCalledWith('my-note')
    expect(p.setComposing).toHaveBeenCalledWith(true)
    expect(repo.save).not.toHaveBeenCalled()
    expect(p.flash).toHaveBeenCalledWith('已读入，确认后点「创建文章」')

    await act(async () => result.current.createArticle())
    expect(vi.mocked(repo.save).mock.calls[0][0].origin).toBe('file')
  })

  it('文件读入后用户重新手输：来源改回 paste', async () => {
    const { repo, result } = setup({ manual: 'Hello there.' })
    await act(async () =>
      result.current.onImportFiles(fileList([new File(['Hello there.'], 'my-note.md')])),
    )
    act(() => result.current.markPaste())
    await act(async () => result.current.createArticle())
    expect(vi.mocked(repo.save).mock.calls[0][0].origin).toBe('paste')
  })

  it('多文件：每篇都保存，刷新列表并提示数量', async () => {
    const { p, repo, result } = setup()
    await act(async () =>
      result.current.onImportFiles(
        fileList([new File(['One.'], 'a.txt'), new File(['Two.'], 'b.txt')]),
      ),
    )
    expect(repo.save).toHaveBeenCalledTimes(2)
    const ids = vi.mocked(repo.save).mock.calls.map((c) => c[0].id)
    expect(new Set(ids).size).toBe(2)
    expect(vi.mocked(repo.save).mock.calls.map((c) => c[0].title)).toEqual(['a', 'b'])
    expect(vi.mocked(repo.save).mock.calls.map((c) => c[0].origin)).toEqual(['file', 'file'])
    expect(p.setSaved).toHaveBeenCalled()
    expect(p.flash).toHaveBeenCalledWith('已导入 2 篇')
  })

  it('没有选文件：什么都不做', async () => {
    const { p, repo, result } = setup()
    await act(async () => result.current.onImportFiles(null))
    expect(repo.save).not.toHaveBeenCalled()
    expect(p.flash).not.toHaveBeenCalled()
  })
})

describe('useArticleImport：PDF / EPUB', () => {
  it('PDF 成功：按页码范围抽取，填 composer，最后清掉 importing', async () => {
    pdf.mockResolvedValue('PDF text')
    const { p, repo, result } = setup({ manual: 'PDF text' })
    await act(async () => result.current.onPickPdf(new File(['x'], 'book.pdf')))
    expect(pdf).toHaveBeenCalledWith(expect.any(File), '1-3')
    expect(p.setImporting).toHaveBeenNthCalledWith(1, '正在解析 PDF…')
    expect(p.setManual).toHaveBeenCalledWith('PDF text')
    expect(p.setNewTitle).toHaveBeenCalledWith('book')
    expect(p.setComposing).toHaveBeenCalledWith(true)
    expect(p.flash).toHaveBeenCalledWith('PDF 已解析，检查正文后点「创建文章」')
    expect(p.setImporting).toHaveBeenLastCalledWith('')

    await act(async () => result.current.createArticle())
    expect(vi.mocked(repo.save).mock.calls[0][0].origin).toBe('file')
  })

  it('PDF 失败：提示扫描件，importing 也会清掉', async () => {
    pdf.mockRejectedValue(new Error('no text layer'))
    const { p, result } = setup()
    await act(async () => result.current.onPickPdf(new File(['x'], 'book.pdf')))
    expect(p.flash).toHaveBeenCalledWith('PDF 解析失败（可能是扫描件，没有文字层）')
    expect(p.setImporting).toHaveBeenLastCalledWith('')
  })

  it('EPUB：按章拆成多篇，标题带书名', async () => {
    epub.mockResolvedValue([
      { title: '第一章', text: 'One.' },
      { title: '', text: 'Two.' },
    ])
    const { p, repo, result } = setup()
    await act(async () => result.current.onPickEpub(new File(['x'], 'my-book.epub')))
    expect(repo.save).toHaveBeenCalledTimes(2)
    expect(vi.mocked(repo.save).mock.calls.map((c) => c[0].title)).toEqual([
      'my-book · 第一章',
      'my-book · 第 2 章',
    ])
    expect(vi.mocked(repo.save).mock.calls.map((c) => c[0].origin)).toEqual(['epub', 'epub'])
    expect(p.flash).toHaveBeenCalledWith('已导入《my-book》共 2 章')
    expect(p.setImporting).toHaveBeenLastCalledWith('')
  })

  it('EPUB 没文本 / 解析失败：提示且不入库', async () => {
    const empty = setup()
    epub.mockResolvedValue([])
    await act(async () => empty.result.current.onPickEpub(new File(['x'], 'a.epub')))
    expect(empty.repo.save).not.toHaveBeenCalled()
    expect(empty.p.flash).toHaveBeenCalledWith('EPUB 里没读到文本')

    const broken = setup()
    epub.mockRejectedValue(new Error('bad zip'))
    await act(async () => broken.result.current.onPickEpub(new File(['x'], 'b.epub')))
    expect(broken.repo.save).not.toHaveBeenCalled()
    expect(broken.p.flash).toHaveBeenCalledWith('EPUB 解析失败')
  })

  it('没选文件：不进入解析，也不改 importing', async () => {
    const { p, result } = setup()
    await act(async () => result.current.onPickPdf(null))
    await act(async () => result.current.onPickEpub(undefined))
    expect(pdf).not.toHaveBeenCalled()
    expect(epub).not.toHaveBeenCalled()
    expect(p.setImporting).not.toHaveBeenCalled()
  })
})
