// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ArticleBook } from '../../core/matchArticle'
import type { SavedArticle } from '../../core/ports'
import type { TtsAccent } from '../../core/ttsVoices'
import ReaderToolbar, { type ReaderToolbarProps } from './ReaderToolbar'

const book: ArticleBook = {
  '009 Leaders - Interest-rate caps': { title: 'Leaders', words: 100, text: 'Text.' },
  '005-Leaders---The-green-boom': { title: 'Green', words: 100, text: 'Text.' },
}

const saved: SavedArticle[] = [
  {
    id: 'saved:1',
    title: 'Saved',
    sourceKey: null,
    text: 'Saved text.',
    paragraphs: [],
    sentences: [],
    updatedAt: '2026-10-20T00:00:00.000Z',
  },
]

const accents: TtsAccent[] = [
  { label: '美式', voices: [{ id: 'en-US-AriaNeural', name: 'Aria', gender: '女' }] },
  { label: '英式', voices: [{ id: 'en-GB-SoniaNeural', name: 'Sonia', gender: '女' }] },
]

function props(over: Partial<ReaderToolbarProps> = {}): ReaderToolbarProps {
  const noop = vi.fn()
  return {
    book: null,
    editions: [],
    edition: '全部',
    onEditionChange: noop,
    bookKeysCount: 0,
    saved: [],
    savedGroups: [],
    shownKeys: [],
    currentValue: '',
    onPickArticle: noop,
    hasDoc: false,
    editing: false,
    savedId: null,
    onSave: noop,
    onNewArticle: noop,
    vocabMode: false,
    onToggleVocab: noop,
    onTranslateAll: noop,
    vocabLevel: 'cet4',
    onVocabLevelChange: noop,
    onAutoVocab: noop,
    translateView: 'off',
    onTranslateViewChange: noop,
    autoSpeak: false,
    onAutoSpeakChange: noop,
    selectedId: null,
    onSpeakSelected: noop,
    readingAll: false,
    onToggleReadAll: noop,
    onSpeedRead: noop,
    onOpenIntensive: noop,
    onOpenJournal: noop,
    onOpenGoals: noop,
    ttsState: 'idle',
    ttsVoice: 'en-US-AriaNeural',
    onTtsVoiceChange: noop,
    ttsAccents: accents,
    pregenRunning: false,
    pregenDone: 0,
    pregenTotal: 0,
    onPregenerate: noop,
    onCancelPregenerate: noop,
    pregenAllCached: false,
    onEnterEdit: noop,
    draft: '',
    onCleanupEdit: noop,
    onApplyEdit: noop,
    onCancelEdit: noop,
    vocabSeconds: 65,
    sessionPicked: 2,
    todayPicked: 5,
    streak: 3,
    totalPicked: 42,
    totalSeconds: 3600,
    studiedCount: 7,
    dailyGoal: 20,
    libraryCount: 88,
    fontSize: 'md',
    onFontSizeChange: noop,
    bold: false,
    onBoldChange: noop,
    serif: false,
    onSerifChange: noop,
    eye: false,
    onEyeChange: noop,
    confirmDelSave: false,
    onDeleteSave: noop,
    ...over,
  }
}

describe('ReaderToolbar：没有文章', () => {
  it('只保留保存（禁用）/新建/目标/统计/显示设置', () => {
    render(<ReaderToolbar {...props()} />)
    expect((screen.getByRole('button', { name: '保存这篇' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: '＋ 新建文章' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /目标/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /选词模式/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '⚡ 速读' })).toBeNull()
    expect(screen.queryByRole('button', { name: /精读/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /日志/ })).toBeNull()
    expect(screen.getByText('88 个生词')).toBeTruthy()
    expect(screen.getByText(/🎯 7\/20 · 🔥3/)).toBeTruthy()
  })

  it('期次筛选只在多于一期且已有原文库时出现', () => {
    const onEditionChange = vi.fn()
    const { rerender } = render(<ReaderToolbar {...props({ book, editions: [] })} />)
    expect(screen.queryByTitle('按期次筛选内置文章')).toBeNull()

    const editions: [string, number][] = [
      ['2021-06-12', 1],
      ['2016-09-10', 1],
    ]
    rerender(<ReaderToolbar {...props({ book, editions, onEditionChange })} />)
    fireEvent.change(screen.getByTitle('按期次筛选内置文章'), { target: { value: '2021-06-12' } })
    expect(onEditionChange).toHaveBeenCalledWith('2021-06-12')
  })
})

describe('ReaderToolbar：阅读操作', () => {
  it('选词模式高亮并显示计时统计；全文翻译/自动标词/级别切换', () => {
    const onToggleVocab = vi.fn()
    const onTranslateAll = vi.fn()
    const onVocabLevelChange = vi.fn()
    const onAutoVocab = vi.fn()
    const { rerender } = render(
      <ReaderToolbar
        {...props({ hasDoc: true, onToggleVocab, onTranslateAll, onVocabLevelChange, onAutoVocab })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '选词模式' }))
    expect(onToggleVocab).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '全文翻译' }))
    expect(onTranslateAll).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '自动标词' }))
    expect(onAutoVocab).toHaveBeenCalled()
    fireEvent.change(screen.getByTitle('自动标词的词汇标准'), { target: { value: 'cet6' } })
    expect(onVocabLevelChange).toHaveBeenCalledWith('cet6')

    rerender(<ReaderToolbar {...props({ hasDoc: true, vocabMode: true })} />)
    expect((screen.getByRole('button', { name: '选词模式 · 开' }) as HTMLButtonElement).className).toBe('primary')
    expect(screen.getByText(/本轮 2 · 今日 5 ·🔥3 · 累计 42 词/)).toBeTruthy()
  })

  it('译文视图/选中朗读/朗读全文/语音选择', () => {
    const onTranslateViewChange = vi.fn()
    const onAutoSpeakChange = vi.fn()
    const onSpeakSelected = vi.fn()
    const onToggleReadAll = vi.fn()
    const onTtsVoiceChange = vi.fn()
    const { rerender } = render(
      <ReaderToolbar
        {...props({
          hasDoc: true,
          selectedId: 's1',
          onTranslateViewChange,
          onAutoSpeakChange,
          onSpeakSelected,
          onToggleReadAll,
          onTtsVoiceChange,
        })}
      />,
    )
    fireEvent.change(screen.getByTitle(/译文显示/), { target: { value: 'below' } })
    expect(onTranslateViewChange).toHaveBeenCalledWith('below')
    fireEvent.click(screen.getByLabelText('选中朗读'))
    expect(onAutoSpeakChange).toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: '🔊 读本句' }))
    expect(onSpeakSelected).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '🔊 朗读全文' }))
    expect(onToggleReadAll).toHaveBeenCalled()
    fireEvent.change(screen.getByTitle(/朗读音色/), { target: { value: 'en-GB-SoniaNeural' } })
    expect(onTtsVoiceChange).toHaveBeenCalledWith('en-GB-SoniaNeural')

    rerender(<ReaderToolbar {...props({ hasDoc: true, ttsState: 'loading' })} />)
    expect(screen.getByRole('button', { name: '🔊 合成中…' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '🔊 准备中…' })).toBeTruthy()

    rerender(<ReaderToolbar {...props({ hasDoc: true, ttsState: 'playing' })} />)
    expect(screen.getAllByRole('button', { name: '🔊 朗读中' }).length).toBeGreaterThan(0)
    rerender(<ReaderToolbar {...props({ hasDoc: true, readingAll: true })} />)
    expect(screen.getByRole('button', { name: '⏹ 停止朗读' })).toBeTruthy()
  })

  it('离线音色提示无逐词高亮（Edge 音色不提示）', () => {
    const { rerender } = render(<ReaderToolbar {...props({ hasDoc: true })} />)
    expect(screen.queryByText('无逐词高亮')).toBeNull()
    rerender(<ReaderToolbar {...props({ hasDoc: true, ttsVoice: 'local:piper-us' })} />)
    expect(screen.getByText('无逐词高亮')).toBeTruthy()
  })

  it('没有选中句时「读本句」禁用', () => {
    render(<ReaderToolbar {...props({ hasDoc: true })} />)
    expect((screen.getByRole('button', { name: '🔊 读本句' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('预生成朗读三态：普通/生成中可取消/已缓存', () => {
    const onPregenerate = vi.fn()
    const onCancelPregenerate = vi.fn()
    const { rerender } = render(
      <ReaderToolbar {...props({ hasDoc: true, onPregenerate, onCancelPregenerate })} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '⬇ 预生成朗读' }))
    expect(onPregenerate).toHaveBeenCalled()

    rerender(
      <ReaderToolbar
        {...props({ hasDoc: true, pregenRunning: true, pregenDone: 3, pregenTotal: 9, onCancelPregenerate })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '⏳ 生成中 3/9' }))
    expect(onCancelPregenerate).toHaveBeenCalled()

    rerender(<ReaderToolbar {...props({ hasDoc: true, pregenAllCached: true })} />)
    expect(screen.getByRole('button', { name: '✅ 已全部缓存' })).toBeTruthy()
  })

  it('速读/精读/日志/目标/编辑/删除保存都走回调', () => {
    const callbacks = {
      onSpeedRead: vi.fn(),
      onOpenIntensive: vi.fn(),
      onOpenJournal: vi.fn(),
      onOpenGoals: vi.fn(),
      onEnterEdit: vi.fn(),
      onDeleteSave: vi.fn(),
    }
    render(<ReaderToolbar {...props({ hasDoc: true, savedId: 'saved:1', ...callbacks })} />)
    fireEvent.click(screen.getByRole('button', { name: '⚡ 速读' }))
    fireEvent.click(screen.getByRole('button', { name: '🎯 精读' }))
    fireEvent.click(screen.getByRole('button', { name: '📅 日志' }))
    fireEvent.click(screen.getByRole('button', { name: '📌 目标' }))
    fireEvent.click(screen.getByRole('button', { name: '编辑正文' }))
    fireEvent.click(screen.getByRole('button', { name: '删除保存' }))
    for (const fn of Object.values(callbacks)) expect(fn).toHaveBeenCalled()
  })
})

describe('ReaderToolbar：编辑态与显示设置', () => {
  it('编辑态替换阅读操作：清洗（空草稿禁用）/完成/取消', () => {
    const onCleanupEdit = vi.fn()
    const onApplyEdit = vi.fn()
    const onCancelEdit = vi.fn()
    const { rerender } = render(
      <ReaderToolbar
        {...props({ hasDoc: true, editing: true, onCleanupEdit, onApplyEdit, onCancelEdit })}
      />,
    )
    expect(screen.queryByRole('button', { name: '⚡ 速读' })).toBeNull()
    expect(screen.queryByRole('button', { name: '保存这篇' })).toBeTruthy()
    expect((screen.getByRole('button', { name: '生成清洗提示词' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onApplyEdit).toHaveBeenCalled()
    expect(onCancelEdit).toHaveBeenCalled()

    rerender(
      <ReaderToolbar {...props({ hasDoc: true, editing: true, draft: 'text', onCleanupEdit })} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '生成清洗提示词' }))
    expect(onCleanupEdit).toHaveBeenCalled()
  })

  it('显示设置：字号/加粗/衬线/护眼', () => {
    const onFontSizeChange = vi.fn()
    const onBoldChange = vi.fn()
    const onSerifChange = vi.fn()
    const onEyeChange = vi.fn()
    render(
      <ReaderToolbar
        {...props({ onFontSizeChange, onBoldChange, onSerifChange, onEyeChange })}
      />,
    )
    fireEvent.change(screen.getByTitle('正文字号'), { target: { value: 'lg' } })
    fireEvent.click(screen.getByLabelText('加粗'))
    fireEvent.click(screen.getByLabelText('衬线'))
    fireEvent.click(screen.getByLabelText('护眼'))
    expect(onFontSizeChange).toHaveBeenCalledWith('lg')
    expect(onBoldChange).toHaveBeenCalledWith(true)
    expect(onSerifChange).toHaveBeenCalledWith(true)
    expect(onEyeChange).toHaveBeenCalledWith(true)
  })

  it('保存按钮在有文档时可点；删除保存两步文案', () => {
    const onSave = vi.fn()
    const { rerender } = render(<ReaderToolbar {...props({ hasDoc: true, onSave })} />)
    fireEvent.click(screen.getByRole('button', { name: '保存这篇' }))
    expect(onSave).toHaveBeenCalled()

    rerender(<ReaderToolbar {...props({ hasDoc: true, savedId: 'saved:1', confirmDelSave: true })} />)
    expect(screen.getByRole('button', { name: '确认删除保存' })).toBeTruthy()
  })

  it('有原文库/已保存文章时渲染文章选择器', () => {
    const { container } = render(
      <ReaderToolbar {...props({ book, saved, savedGroups: [['未分组', saved]] })} />,
    )
    expect(container.querySelector('.picker')).toBeTruthy()
    expect(screen.getByRole('button', { name: /选择文章/ })).toBeTruthy()
  })
})
