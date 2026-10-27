// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { ReaderToolbarHostProps } from './ReaderToolbarHost'

/** 捕获宿主传给 ReaderToolbar 的 props。 */
let captured: any = null
vi.mock('./panels/ReaderToolbar', () => ({
  default: (props: any) => {
    captured = props
    return <div data-testid="toolbar" />
  },
}))

import ReaderToolbarHost from './ReaderToolbarHost'

const fn = () => vi.fn()

function makeProps(over: Partial<ReaderToolbarHostProps> = {}): ReaderToolbarHostProps {
  const docApi = {
    loadSaved: fn(),
    saveCurrent: fn(),
    askDeleteSave: fn(),
    renameArticle: fn(),
    enterEdit: fn(),
    applyEdit: fn(),
    cancelEdit: fn(),
    onPick: fn(),
    bookKeys: ['a', 'b'],
    editions: [['全部', 2]] as [string, number][],
    shownKeys: ['a', 'b'],
  }
  return {
    docApi: docApi as never,
    edition: '全部',
    onEditionChange: fn(),
    book: null,
    saved: [],
    savedGroups: [],
    readDays: { a: '2026-10-20' },
    currentValue: 'b:a',
    doc: { sentences: [{ id: 's1', text: 'Hello world.' }] },
    selectedId: 's1',
    speak: fn(),
    editing: false,
    savedId: null,
    onNewArticle: fn(),
    vocab: {
      mode: false,
      onToggle: fn(),
      level: 'cet6',
      onLevelChange: fn(),
      translateView: 'off',
      onTranslateViewChange: fn(),
      autoSpeak: false,
      onAutoSpeakChange: fn(),
      onTranslateAll: fn(),
      onAutoVocab: fn(),
    },
    reading: {
      all: false,
      onToggleAll: fn(),
      onSpeedRead: fn(),
      onOpenGolden: fn(),
      onOpenBack: fn(),
      onOpenIntensive: fn(),
      onOpenJournal: fn(),
      onOpenGoals: fn(),
    },
    tts: { state: 'idle', voice: 'v1', onVoiceChange: fn(), accents: [] },
    pregen: { running: true, done: 2, total: 5, allCached: true, onStart: fn(), onCancel: fn() },
    edit: { draft: 'draft', onCleanup: fn() },
    stats: {
      vocabSeconds: 12,
      sessionPicked: 3,
      todayPicked: 4,
      streak: 5,
      totalPicked: 60,
      totalSeconds: 1200,
      studiedCount: 7,
      dailyGoal: 20,
      libraryCount: 300,
    },
    display: {
      fontSize: 'md',
      onFontSizeChange: fn(),
      bold: false,
      onBoldChange: fn(),
      serif: false,
      onSerifChange: fn(),
      eye: false,
      toolbarWidth: 'auto' as const,
      onToolbarWidthChange: fn(),
      toolbarRows: 4 as const,
      onToolbarRowsChange: fn(),
      onEyeChange: fn(),
    },
    confirmDelSave: false,
    ...over,
  }
}

function renderHost(over: Partial<ReaderToolbarHostProps> = {}) {
  const props = makeProps(over)
  render(<ReaderToolbarHost {...props} />)
  if (!captured) throw new Error('没有渲染 ReaderToolbar')
  return { props, toolbar: captured }
}

describe('ReaderToolbarHost：文章选择与文档动作', () => {
  it('useReaderDoc 整包映射（editions/shownKeys/bookKeysCount/保存/编辑/删除）', () => {
    const { props, toolbar } = renderHost()
    const api = props.docApi as unknown as Record<string, any>
    expect(toolbar.editions).toBe(api.editions)
    expect(toolbar.shownKeys).toBe(api.shownKeys)
    expect(toolbar.bookKeysCount).toBe(2)
    expect(toolbar.onPickArticle).toBe(api.onPick)
    expect(toolbar.onSave).toBe(api.saveCurrent)
    expect(toolbar.onEnterEdit).toBe(api.enterEdit)
    expect(toolbar.onApplyEdit).toBe(api.applyEdit)
    expect(toolbar.onCancelEdit).toBe(api.cancelEdit)
    expect(toolbar.onDeleteSave).toBe(api.askDeleteSave)
    expect(toolbar.readDays).toEqual({ a: '2026-10-20' })
    expect(toolbar.currentValue).toBe('b:a')
  })

  it('可见性由调用方控制（readingView 为 false 时不渲染）', () => {
    captured = null
    const { container } = render(
      <ReaderToolbarHost {...makeProps({ visible: false })} />,
    )
    expect(container.innerHTML).toBe('')
    expect(captured).toBeNull()
  })
})

describe('ReaderToolbarHost：朗读与设置映射', () => {
  it('读选中句：按 selectedId 找句子再 speak', () => {
    const { props, toolbar } = renderHost()
    toolbar.onSpeakSelected()
    expect(props.speak).toHaveBeenCalledWith('Hello world.')
  })

  it('没有选中句时不动', () => {
    const { props, toolbar } = renderHost({ selectedId: null })
    toolbar.onSpeakSelected()
    expect(props.speak).not.toHaveBeenCalled()
  })

  it('TTS / 预生成 / 翻译 / 自动标词 / 显示设置按组展开', () => {
    const { props, toolbar } = renderHost()
    expect(toolbar.ttsVoice).toBe('v1')
    expect(toolbar.ttsState).toBe('idle')
    expect(toolbar.onTtsVoiceChange).toBe(props.tts.onVoiceChange)
    expect(toolbar.ttsAccents).toBe(props.tts.accents)
    expect(toolbar.pregenRunning).toBe(true)
    expect(toolbar.pregenDone).toBe(2)
    expect(toolbar.pregenTotal).toBe(5)
    expect(toolbar.pregenAllCached).toBe(true)
    expect(toolbar.onPregenerate).toBe(props.pregen.onStart)
    expect(toolbar.onCancelPregenerate).toBe(props.pregen.onCancel)
    expect(toolbar.onTranslateAll).toBe(props.vocab.onTranslateAll)
    expect(toolbar.onAutoVocab).toBe(props.vocab.onAutoVocab)
    expect(toolbar.vocabLevel).toBe('cet6')
    expect(toolbar.translateView).toBe('off')
    expect(toolbar.autoSpeak).toBe(false)
    expect(toolbar.fontSize).toBe('md')
    expect(toolbar.onBoldChange).toBe(props.display.onBoldChange)
  })

  it('统计 / 编辑态 / 删除确认透传', () => {
    const { props, toolbar } = renderHost()
    expect(toolbar.vocabSeconds).toBe(12)
    expect(toolbar.sessionPicked).toBe(3)
    expect(toolbar.todayPicked).toBe(4)
    expect(toolbar.streak).toBe(5)
    expect(toolbar.totalPicked).toBe(60)
    expect(toolbar.totalSeconds).toBe(1200)
    expect(toolbar.studiedCount).toBe(7)
    expect(toolbar.dailyGoal).toBe(20)
    expect(toolbar.libraryCount).toBe(300)
    expect(toolbar.draft).toBe('draft')
    expect(toolbar.onCleanupEdit).toBe(props.edit.onCleanup)
    expect(toolbar.confirmDelSave).toBe(false)
    expect(toolbar.hasDoc).toBe(true)
  })
})
