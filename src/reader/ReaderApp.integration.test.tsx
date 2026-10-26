// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { installFakeStorage } from './testStorage'
import type { Sentence } from '../types/document'

/**
 * ReaderApp 集成（**假仓储挂载**）：
 * 恢复上次文章 → 词库自动补全只写一次。
 *
 * 单测已经分别钉住 `useLibraryAutoFill`（唯一写入口）和 `useVocabLibrary`（读失败不写）；
 * 这里补的是「整机接线」——启动恢复文章的路径上，补全不会因为依赖抖动写第二遍。
 */

const vocabState = vi.hoisted(() => ({
  saved: [] as { items: { word: string }[] }[],
  library: { schemaVersion: 1, items: [] as unknown[] },
}))

const articleState = vi.hoisted(() => ({ list: [] as unknown[] }))

vi.mock('../adapters/vocabRepo', () => ({
  createVocabRepo: () => ({
    load: async () => vocabState.library,
    save: async (l: typeof vocabState.library) => {
      vocabState.saved.push(l as never)
      vocabState.library = l
    },
    clear: async () => {},
  }),
}))

vi.mock('../adapters/articleRepo', () => ({
  createArticleRepo: () => ({
    list: async () => articleState.list,
    get: async (id: string) => (articleState.list as { id: string }[]).find((a) => a.id === id) ?? null,
    save: async () => {},
    remove: async () => {},
    reconcile: async () => {},
  }),
}))

vi.mock('../adapters/learningRepo', () => ({
  learningRepo: {
    load: async () => null,
    save: async () => {},
    savePartial: async () => {},
    migrate: async () => null,
  },
}))

vi.mock('../adapters/dictionary', () => ({
  dictionary: () => null,
  mwldLookupWord: () => null,
  loadDictionary: async () => false,
  dictionaryReady: () => true,
}))

vi.mock('../adapters/tatoeba', () => ({
  loadTatoeba: async () => false,
  tatoebaExamples: () => [],
}))

import { MemoryRouter, useLocation } from 'react-router-dom'
import ReaderApp from './ReaderApp'

const withLang = (id: string, text: string, phrases: string[]): Sentence => ({
  id,
  paraId: 'p1',
  text,
  audio: null,
  translation: null,
  grammarNote: null,
  collocations: [],
  vocab: [],
  languages: [{ phrases, usage: [], source: 'ai' }],
  tags: [],
  reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
})

let restoreStorage: () => void = () => {}

beforeEach(() => {
  restoreStorage = installFakeStorage()
  vocabState.saved = []
  vocabState.library = { schemaVersion: 1, items: [] }
  const sentence = withLang('s1', 'He falls back on it.', ['fall back on — 转而依靠'])
  articleState.list = [
    {
      id: 'A1',
      title: 'Integration',
      sourceKey: null,
      text: sentence.text,
      paragraphs: [{ id: 'p1', sentenceIds: ['s1'] }],
      sentences: [sentence],
      updatedAt: '2026-10-01T00:00:00.000Z',
    },
  ]
  localStorage.setItem('reader:last', JSON.stringify({ key: null, id: 'A1' }))
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('articles.json')) return { ok: true, json: async () => ({}) } as Response
      return { ok: false, status: 404, json: async () => ({}) } as Response
    }),
  )
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }),
  })
})

afterEach(() => {
  restoreStorage()
  vi.unstubAllGlobals()
})

describe('ReaderApp 集成', () => {
  it('恢复上次文章后，自动补全只写一次且收下语言点', async () => {
    render(<MemoryRouter><ReaderApp /></MemoryRouter>)

    await waitFor(() => expect(vocabState.saved).toHaveLength(1))
    expect(vocabState.saved[0].items.map((it) => it.word)).toEqual(['fall back on'])

    // 再等一拍：依赖抖动不能再写第二遍（否则就是「数量来回跳」的老坑）
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(vocabState.saved).toHaveLength(1)
  })

  it('数字键 1 与 W 一样切换选词模式', async () => {
    render(<MemoryRouter><ReaderApp /></MemoryRouter>)
    await screen.findByRole('button', { name: '选词模式(1)' }, { timeout: 5000 })

    fireEvent.keyDown(window, { key: '1', code: 'Digit1' })
    await waitFor(() => expect(screen.getByRole('button', { name: '选词模式(1) · 开' })).toBeTruthy(), {
      timeout: 5000,
    })

    fireEvent.keyDown(window, { key: '1', code: 'Digit1' })
    await waitFor(() => expect(screen.getByRole('button', { name: '选词模式(1)' })).toBeTruthy(), {
      timeout: 5000,
    })
  })

  it('粘回语言点结果：写进词库一次，重复应用不重不漏', async () => {
    render(<MemoryRouter><ReaderApp /></MemoryRouter>)
    await waitFor(() => expect(vocabState.saved).toHaveLength(1))

    const raw = JSON.stringify({ sentences: [{ id: 's1', phrases: ['take its toll — 造成损害'] }] })
    const box = screen.getByPlaceholderText(/把 DeepSeek 的结果粘回这里/)
    fireEvent.change(box, { target: { value: raw } })
    fireEvent.click(screen.getByRole('button', { name: '应用结果' }))

    await waitFor(() => expect(vocabState.saved).toHaveLength(2))
    const words = vocabState.saved[1].items.map((it) => it.word)
    expect(words).toContain('take its toll')
    expect(words.filter((w) => w === 'take its toll')).toHaveLength(1)

    // 同一份结果再应用一次：不应多出条目、也不该再写一次
    fireEvent.change(box, { target: { value: raw } })
    fireEvent.click(screen.getByRole('button', { name: '应用结果' }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40))
    })
    expect(vocabState.saved).toHaveLength(2)
    expect(vocabState.saved[1].items.filter((it) => it.word === 'take its toll')).toHaveLength(1)
  })

  it('速读里打开语言点：地址叠成 /p/speed/lang，关掉回速读（不掉回阅读主界面）', async () => {
    let path = ''
    function Probe() {
      path = useLocation().pathname
      return null
    }
    render(
      <MemoryRouter initialEntries={['/reader']}>
        <Probe />
        <ReaderApp />
      </MemoryRouter>,
    )
    await waitFor(() => expect(vocabState.saved).toHaveLength(1))

    // 打开速读：地址多一层 /p/speed
    fireEvent.click(await screen.findByRole('button', { name: '⚡ 速读' }))
    await waitFor(() => expect(path).toMatch(/\/p\/speed$/), { timeout: 5000 })

    // 点「语言点」：语言点盖在速读上，底下的速读不能被关掉
    fireEvent.click(
      await screen.findByTitle(
        '编辑这一句的语言点（结构 / 语法 / 习语 / 词组 / 用法）：已有的会带出来，没有就是新增',
      ),
    )
    await waitFor(() => expect(path).toMatch(/\/p\/speed\/lang$/), { timeout: 5000 })
    // 语言点编辑器真的盖在速读上（侧栏也有一个「语言点（N）」页签，所以限定在弹层里找）
    await waitFor(() => expect(document.querySelector('.lang-editor')).toBeTruthy(), { timeout: 5000 })
    expect(document.querySelector('.lang-editor')?.textContent).toContain('语言点（1）')
    expect(screen.getByText('第 1 / 1 句')).toBeTruthy()

    // 取消：replace 回 /p/speed，速读还在原来那一句
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(path).toMatch(/\/p\/speed$/), { timeout: 5000 })
    expect(screen.getByText('第 1 / 1 句')).toBeTruthy()
  }, 15000)
})
