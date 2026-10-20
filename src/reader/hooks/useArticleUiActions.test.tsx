// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { sentenceFixture, vocabItem } from '../../core/testFixtures'
import { useArticleUiActions } from './useArticleUiActions'

const tatoeba = vi.hoisted(() => ({
  loadTatoeba: vi.fn(async () => false),
  tatoebaExamples: vi.fn(() => [] as string[]),
}))
vi.mock('../../adapters/tatoeba', () => tatoeba)

function setup(over: Record<string, unknown> = {}) {
  const flash = vi.fn()
  const persist = vi.fn()
  const speak = vi.fn()
  const speakRange = vi.fn()
  const setSideTab = vi.fn()
  const focusEntry = vi.fn()
  const selectSentence = vi.fn()
  const params = {
    flash,
    confirmDel: null,
    setConfirmDel: vi.fn(),
    confirmTimerRef: { current: null },
    library: { items: [vocabItem({ id: 'v1', word: 'run', lemma: 'run' })] },
    persist,
    speak,
    speakRange,
    speakNowPlaying: {
      text: 'Hello there',
      ms: 120,
      wordTimings: [
        { start: 0, end: 100 },
        { start: 100, end: 200 },
      ],
    },
    doc: { paragraphs: [], sentences: [sentenceFixture('s1', 'Hello there')] },
    selectedId: null,
    selectSentence,
    autoSpeak: false,
    setSideTab,
    focusEntry,
    articleWords: [vocabItem({ id: 'v1', word: 'run', lemma: 'run' })],
    lookupTatoeba: vi.fn(() => []),
    ...over,
  }
  const hook = renderHook(() => useArticleUiActions(params as never))
  return { ...hook, params, flash, persist, speak, speakRange, setSideTab, focusEntry, selectSentence }
}

describe('useArticleUiActions：正文动作', () => {
  it('逐词高亮定位到当前句和词下标', () => {
    const { result } = setup()
    expect(result.current.karaoke).toEqual({ sid: 's1', activeIndex: 1 })
  })

  it('Alt 复制去空白；空文本不碰剪贴板', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const { result, flash } = setup()
    await act(async () => result.current.altCopyText('  hi  '))
    expect(writeText).toHaveBeenCalledWith('hi')
    expect(flash).toHaveBeenCalledWith('已复制（Alt 点击）')

    writeText.mockClear()
    await act(async () => result.current.altCopyText('   '))
    expect(writeText).not.toHaveBeenCalled()
  })

  it('删除两步确认：第一次只标记，第二次真删', () => {
    vi.useFakeTimers()
    try {
      const setConfirmDel = vi.fn()
      const first = setup({ setConfirmDel })
      act(() => first.result.current.askDelete('v1'))
      expect(setConfirmDel).toHaveBeenCalledWith('v1')
      expect(first.persist).not.toHaveBeenCalled()

      const second = setup({ confirmDel: 'v1', setConfirmDel })
      act(() => second.result.current.askDelete('v1'))
      expect(second.persist).toHaveBeenCalledOnce()
      expect(second.persist.mock.calls[0][0].items).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('点句：新句且开了选中朗读才读', () => {
    const { result, speak, selectSentence } = setup({ autoSpeak: true })
    act(() => result.current.selectSentenceAndRead('s1'))
    expect(selectSentence).toHaveBeenCalledWith('s1')
    expect(speak).toHaveBeenCalledWith('Hello there')

    const again = setup({ autoSpeak: true, selectedId: 's1' })
    act(() => again.result.current.selectSentenceAndRead('s1'))
    expect(again.speak).not.toHaveBeenCalled()
  })

  it('听写播放：有源句区间走 speakRange，否则整段读', () => {
    const { result, speak, speakRange } = setup()
    act(() => result.current.playDictItem({ text: 'x', src: 'src', sw: 1, ew: 3 }))
    expect(speakRange).toHaveBeenCalledWith('src', 1, 3)
    act(() => result.current.playDictItem({ text: 'whole' }))
    expect(speak).toHaveBeenCalledWith('whole')
  })

  it('点生词切到生词本并定位', () => {
    const { result, setSideTab, focusEntry } = setup()
    act(() => result.current.revealVocabWord('run'))
    expect(setSideTab).toHaveBeenCalledWith('vocab')
    expect(focusEntry).toHaveBeenCalledWith('run')
  })
})

describe('useArticleUiActions：离线例句', () => {
  beforeEach(() => tatoeba.loadTatoeba.mockResolvedValue(false))
  afterEach(() => vi.clearAllMocks())

  it('离线库没装时只提示安装命令', async () => {
    const { result, flash } = setup()
    await act(async () => result.current.enrichExamplesFromTatoeba())
    expect(flash.mock.calls[0][0]).toContain('离线例句未安装')
  })
})
