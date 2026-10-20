// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { setDictionary } from '../../adapters/dictionary'
import type { Ecdict, EcdictEntry } from '../../core/ecdict'
import { vocabItem } from '../../core/testFixtures'
import type { VocabLibrary } from '../../types/document'
import { useDictTools, type UseDictToolsParams } from './useDictTools'

function entry(over: Partial<EcdictEntry> & { word: string }): EcdictEntry {
  return {
    phonetic: '',
    pos: '',
    en: '',
    zh: '',
    tag: '',
    collins: 0,
    oxford: 0,
    bnc: 0,
    frq: 0,
    ...over,
  }
}

const dict: Ecdict = {
  entries: new Map([
    ['run', entry({ word: 'run', phonetic: 'rʌn', pos: 'v.', en: 'move fast', zh: '跑', tag: 'cet4' })],
    ['ubiquitous', entry({ word: 'ubiquitous', en: 'present everywhere', zh: '无处不在的', tag: 'gre' })],
    ['ran', entry({ word: 'ran', zh: '跑（过去式）' })],
    ['runs', entry({ word: 'runs', zh: '跑（三单）' })],
    ['ruin', entry({ word: 'ruin', zh: '毁坏' })],
    ['walk', entry({ word: 'walk', zh: '走', tag: 'cet4' })],
  ]),
  forms: new Map([['running', 'run']]),
  near: new Map([['run', ['ran', 'runs', 'ruin']]]),
}

function library(items = [vocabItem({ id: 'v1', word: 'run', lemma: 'run' })]): VocabLibrary {
  return { schemaVersion: 1, items }
}

function params(over: Partial<UseDictToolsParams> = {}) {
  const batchItemsFromWords = vi.fn((words: string[]) =>
    words.map((w) => ({ word: w, sentence: '', sentenceId: null })),
  )
  const p: UseDictToolsParams = {
    library: library(),
    persist: vi.fn(),
    doc: { sentences: [{ id: 's1', text: 'It is ubiquitous.' }] },
    level: 'cet4',
    mergeBatch: vi.fn(),
    batchItemsFromWords,
    flash: vi.fn(),
    ...over,
  }
  return { p, ...renderHook(() => useDictTools(p)) }
}

afterEach(() => {
  setDictionary(null)
  vi.restoreAllMocks()
})

describe('useDictTools：词典未加载', () => {
  it('四个工具都只提示、不改数据', () => {
    setDictionary(null)
    const { p, result } = params()
    result.current.enrichFromDict()
    result.current.fixLemmasFromDict()
    result.current.pickFromDict()
    result.current.confuseFromDict()
    expect(p.persist).not.toHaveBeenCalled()
    expect(p.mergeBatch).not.toHaveBeenCalled()
    expect(vi.mocked(p.flash).mock.calls.map((c) => c[0])).toEqual([
      '词典未加载（先跑 npm run ecdict:build）',
      '词典未加载（先跑 npm run ecdict:build）',
      '词典未加载（先跑 npm run ecdict:build）',
      '词典未加载（先跑 npm run ecdict:build）',
    ])
  })
})

describe('useDictTools：补全 / 校正', () => {
  it('补音标词性释义：写回库并提示数量', () => {
    setDictionary(dict)
    const { p, result } = params()
    result.current.enrichFromDict()
    expect(p.persist).toHaveBeenCalledTimes(1)
    const next = vi.mocked(p.persist).mock.calls[0][0]
    expect(next.items[0]).toMatchObject({ phonetic: '/rʌn/', partOfSpeech: 'v.', meaning: '跑', definition: 'move fast' })
    expect(p.flash).toHaveBeenCalledWith('已用词典补齐 1 个词')
  })

  it('没有可补齐的：不动库', () => {
    setDictionary(dict)
    const full = vocabItem({
      id: 'v1',
      word: 'run',
      lemma: 'run',
      phonetic: '/rʌn/',
      partOfSpeech: 'v.',
      meaning: '跑',
      definition: 'move fast',
    })
    const { p, result } = params({ library: library([full]) })
    result.current.enrichFromDict()
    expect(p.persist).not.toHaveBeenCalled()
    expect(p.flash).toHaveBeenCalledWith('没有可补齐的（词典里没有，或已有数据）')
  })

  it('校正原形并去重', () => {
    setDictionary(dict)
    const { p, result } = params({
      library: library([vocabItem({ id: 'v1', word: 'running', lemma: 'running' })]),
    })
    result.current.fixLemmasFromDict()
    expect(p.persist).toHaveBeenCalledTimes(1)
    const next = vi.mocked(p.persist).mock.calls[0][0]
    expect(next.items[0].lemma).toBe('run')
    expect(p.flash).toHaveBeenCalledWith('已校正 1 个词形')
  })

  it('已是原形：不动库', () => {
    setDictionary(dict)
    const { p, result } = params()
    result.current.fixLemmasFromDict()
    expect(p.persist).not.toHaveBeenCalled()
    expect(p.flash).toHaveBeenCalledWith('没有可校正的原形（词典里查不到或已是原型）')
  })
})

describe('useDictTools：按水平挑超纲词', () => {
  it('挑出超纲词进待选，并提示其中新词数量', () => {
    setDictionary(dict)
    const { p, result } = params()
    result.current.pickFromDict()
    expect(p.batchItemsFromWords).toHaveBeenCalledWith(['ubiquitous'], 'dict')
    expect(p.mergeBatch).toHaveBeenCalledWith([{ word: 'ubiquitous', sentence: '', sentenceId: null }])
    expect(p.flash).toHaveBeenCalledWith('已按词典挑出 1 个超纲词，其中「新 1」个进「待选」')
  })

  it('长文章不截断到 40：提示真实超纲词数量', () => {
    const words = Array.from({ length: 45 }, (_, i) =>
      'w' + String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26)),
    )
    const longDict: Ecdict = {
      entries: new Map(words.map((w) => [w, entry({ word: w, tag: 'gre', zh: '超纲词' })])),
      forms: new Map(),
      near: new Map(),
    }
    setDictionary(longDict)
    const { p, result } = params({ doc: { sentences: [{ id: 's1', text: words.join(' ') }] } })
    result.current.pickFromDict()
    expect(p.batchItemsFromWords).toHaveBeenCalledTimes(1)
    expect((vi.mocked(p.batchItemsFromWords).mock.calls[0][0] as string[]).length).toBe(45)
    expect(p.flash).toHaveBeenCalledWith('已按词典挑出 45 个超纲词，其中「新 45」个进「待选」')
  })

  it('超纲词都已在生词本：不同措辞提示', () => {
    setDictionary(dict)
    const { p, result } = params({
      library: library([vocabItem({ id: 'v1', word: 'ubiquitous', lemma: 'ubiquitous' })]),
    })
    result.current.pickFromDict()
    expect(p.mergeBatch).toHaveBeenCalled()
    expect(p.flash).toHaveBeenCalledWith('挑出的 1 个词都已在生词本里了 —— 去「生词本 / 全部生词」看')
  })

  it('没打开文章 / 没挑出词：给出提示且不改待选', () => {
    setDictionary(dict)
    const noDoc = params({ doc: null })
    noDoc.result.current.pickFromDict()
    expect(noDoc.p.flash).toHaveBeenCalledWith('先打开一篇文章')
    expect(noDoc.p.mergeBatch).not.toHaveBeenCalled()

    const easy = params({ doc: { sentences: [{ id: 's1', text: 'I walk.' }] } })
    easy.result.current.pickFromDict()
    expect(easy.p.flash).toHaveBeenCalledWith('词典没挑出超纲词')
    expect(easy.p.mergeBatch).not.toHaveBeenCalled()
  })
})

describe('useDictTools：一键处理', () => {
  it('按顺序跑，且每步读取上一步 persist 的最新库', async () => {
    setDictionary(dict)
    const calls: string[] = []
    const ref = {
      current: library([
        vocabItem({ id: 'v1', word: 'run', lemma: 'run' }),
        vocabItem({ id: 'v2', word: 'running', lemma: 'running' }),
      ]),
    }
    let round = 0
    const persist = vi.fn((next: VocabLibrary) => {
      ref.current = next
      calls.push(`persist:${++round}`)
    })
    const enrichExamples = vi.fn(async () => {
      calls.push('examples')
    })
    const mergeBatch = vi.fn(() => calls.push('pick'))
    const batchItemsFromWords = vi.fn((words: string[]) =>
      words.map((w) => ({ word: w, sentence: '', sentenceId: null })),
    )
    const p: UseDictToolsParams = {
      library: ref.current,
      libraryRef: ref,
      persist,
      doc: { sentences: [{ id: 's1', text: 'Running is ubiquitous.' }] },
      level: 'cet4',
      mergeBatch,
      batchItemsFromWords,
      flash: vi.fn(),
      enrichExamples,
      stepDelayMs: 0,
    }
    const { result } = renderHook(() => useDictTools(p))
    await act(async () => {
      await result.current.runAll()
    })

    expect(calls).toEqual(['pick', 'persist:1', 'examples', 'persist:2', 'persist:3'])
    expect(ref.current.items.some((it) => it.lemma === 'run' && it.meaning)).toBe(true)
    expect(ref.current.items.find((it) => it.lemma === 'run')?.confusables).toHaveLength(3)
    expect(vi.mocked(p.flash).mock.calls.map((c) => c[0]).at(-1)).toBe(
      '一键处理完成（挑词 / 补齐 / 补例句 / 校正 / 混淆）',
    )
  })
})

describe('useDictTools：混淆项', () => {
  it('给缺混淆项的词生成三条形近词', () => {
    setDictionary(dict)
    const { p, result } = params({
      library: library([vocabItem({ id: 'v1', word: 'run', lemma: 'run', meaning: '跑' })]),
    })
    result.current.confuseFromDict()
    expect(p.persist).toHaveBeenCalledTimes(1)
    const next = vi.mocked(p.persist).mock.calls[0][0]
    expect(next.items[0].confusables).toHaveLength(3)
    expect(p.flash).toHaveBeenCalledWith('已用词典给 1 个词生成混淆项')
  })

  it('已有混淆项 / 没有释义 / 没有形近词时不重复生成', () => {
    setDictionary(dict)
    const { p, result } = params({
      library: library([
        vocabItem({ id: 'v1', word: 'run', lemma: 'run', meaning: '跑', confusables: [{ word: 'ran' }] }),
        vocabItem({ id: 'v2', word: 'walk', lemma: 'walk', meaning: null }),
      ]),
    })
    result.current.confuseFromDict()
    expect(p.persist).not.toHaveBeenCalled()
    expect(p.flash).toHaveBeenCalledWith('词典没生成出混淆项（这些词没有合适的拼写近邻）')
  })
})
