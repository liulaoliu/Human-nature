// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { Paragraph } from '../../types/document'
import { sentenceFixture } from '../../core/testFixtures'
import ReaderBody, { type ReaderBodyProps } from './ReaderBody'

const s1 = sentenceFixture('s1', 'Run fast.', { translation: '跑快点。' })
const s2 = sentenceFixture('s2', 'Walk slow.', { translation: '走慢点。' })
const paragraphs: Paragraph[] = [
  { id: 'p1', sentenceIds: ['s1', 's2'] },
  { id: 'p2', sentenceIds: ['missing'] },
]

function props(over: Partial<ReaderBodyProps> = {}): ReaderBodyProps {
  const noop = vi.fn()
  return {
    paragraphs,
    sentences: [s1, s2],
    translateView: 'off',
    selectedId: null,
    peekSid: null,
    vocabSidSet: new Set(),
    selSid: null,
    selIndices: [],
    libraryLemmas: new Set(),
    articleNums: new Map(),
    articleFirst: new Set(),
    showLanguage: false,
    vocabMode: false,
    lastPicked: null,
    bubblePos: null,
    articleRef: { current: null },
    onSelectSentence: noop,
    onFocusEntry: noop,
    onAltCopyText: noop,
    karaoke: null,
    onWordSeek: noop,
    ...over,
  }
}

describe('ReaderBody：段落与选中', () => {
  it('按段落顺序渲染句子；找不到的句子跳过', () => {
    const { container } = render(<ReaderBody {...props()} />)
    expect(container.querySelectorAll('.sent')).toHaveLength(2)
    expect(container.querySelectorAll('.para')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Run fast.' })).toBeTruthy()
  })

  it('点击/键盘选中句子；Alt+点击复制原文', () => {
    const onSelectSentence = vi.fn()
    const onAltCopyText = vi.fn()
    render(<ReaderBody {...props({ onSelectSentence, onAltCopyText })} />)
    const sent = screen.getByRole('button', { name: 'Run fast.' })
    fireEvent.click(sent)
    expect(onSelectSentence).toHaveBeenCalledWith('s1')

    fireEvent.keyDown(sent, { key: 'Enter' })
    fireEvent.keyDown(sent, { key: ' ' })
    expect(onSelectSentence).toHaveBeenCalledTimes(3)

    fireEvent.click(sent, { altKey: true })
    expect(onAltCopyText).toHaveBeenCalledWith('Run fast.')
    expect(onSelectSentence).toHaveBeenCalledTimes(3)
  })

  it('选中 / 预览 / 有生词三种句子底色可叠加', () => {
    const { container, rerender } = render(
      <ReaderBody {...props({ selectedId: 's1', vocabSidSet: new Set(['s1']) })} />,
    )
    const first = container.querySelector('.sent') as HTMLElement
    expect(first.className).toContain('sel')
    expect(first.className).toContain('has-vocab')

    rerender(<ReaderBody {...props({ peekSid: 's1', selectedId: 's2' })} />)
    expect((container.querySelector('.sent') as HTMLElement).className).toContain('peek')
  })
})

describe('ReaderBody：生词与选词', () => {
  it('生词包成 .vw 并显示首次出现序号；点击打开词条', () => {
    const onFocusEntry = vi.fn()
    render(
      <ReaderBody
        {...props({
          libraryLemmas: new Set(['run']),
          articleNums: new Map([['run', 1]]),
          articleFirst: new Set(['s1:0']),
          onFocusEntry,
        })}
      />,
    )
    const vw = document.querySelector('.vw') as HTMLElement
    expect(vw.textContent).toBe('Run1')
    expect(vw.querySelector('.wnum')?.textContent).toBe('1')
    expect(vw.title).toBe('在生词本里查看')
    fireEvent.click(vw)
    expect(onFocusEntry).toHaveBeenCalledWith('Run')
  })

  it('有释义时悬浮提示含义（生词与朗读词都显示）', () => {
    const wordMeaning = (w: string) => (w.toLowerCase() === 'run' ? '跑' : null)
    const { rerender } = render(
      <ReaderBody {...props({ libraryLemmas: new Set(['run']), wordMeaning })} />,
    )
    const vw = document.querySelector('.vw') as HTMLElement
    expect(vw.title).toBe('含义：跑\n在生词本里查看')

    rerender(
      <ReaderBody
        {...props({
          libraryLemmas: new Set(['run']),
          karaoke: { sid: 's1', activeIndex: 0 },
          wordMeaning,
        })}
      />,
    )
    const words = document.querySelectorAll('.sent')[0].querySelectorAll('.kara')
    expect((words[0] as HTMLElement).title).toBe('含义：跑\n从这个词开始朗读')
    expect((words[1] as HTMLElement).title).toBe('从这个词开始朗读')
  })

  it('精确选区高亮 .hl；点选不触发生词跳转', () => {
    render(
      <ReaderBody
        {...props({
          libraryLemmas: new Set(['run', 'fast']),
          selSid: 's1',
          selIndices: [0, 1],
        })}
      />,
    )
    const hl = [...document.querySelectorAll('.hl')].map((x) => x.textContent)
    expect(hl).toEqual(['Run', 'fast'])
  })

  it('朗读中：每个词可点并从该词起播，当前词高亮', () => {
    const onWordSeek = vi.fn()
    render(
      <ReaderBody {...props({ karaoke: { sid: 's1', activeIndex: 1 }, onWordSeek })} />,
    )
    const words = [...document.querySelectorAll('.sent')[0].querySelectorAll('.kara')]
    expect(words).toHaveLength(2)
    expect(words[1].className).toContain('kara-on')
    expect(words[0].className).not.toContain('kara-on')
    expect(words[0].getAttribute('title')).toBe('从这个词开始朗读')
    fireEvent.click(words[0])
    expect(onWordSeek).toHaveBeenCalledWith('s1', 0)
  })

  it('选词模式且有气泡位置时显示最后选中的词', () => {
    const { rerender } = render(<ReaderBody {...props({ vocabMode: true, lastPicked: { word: 'run' }, bubblePos: { top: 10, left: 20 } })} />)
    const bubble = screen.getByRole('status')
    expect(bubble.textContent).toBe('run')
    expect((bubble as HTMLElement).style.top).toBe('10px')
    expect((bubble as HTMLElement).style.left).toBe('20px')

    rerender(<ReaderBody {...props({ vocabMode: true, lastPicked: { word: 'run' }, bubblePos: null })} />)
    expect(screen.queryByRole('status')).toBeNull()
    rerender(<ReaderBody {...props({ vocabMode: false, lastPicked: { word: 'run' }, bubblePos: { top: 1, left: 1 } })} />)
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('ReaderBody：译文与语言点', () => {
  it('译文 off 不渲染；below 渲染译文与占位；only 加窄栏 class', () => {
    const { container, rerender } = render(<ReaderBody {...props()} />)
    expect(screen.queryByText('跑快点。')).toBeNull()

    rerender(<ReaderBody {...props({ translateView: 'below' })} />)
    expect(screen.getByText('跑快点。')).toBeTruthy()
    expect(container.querySelector('article')?.className).not.toContain('tr-only')

    rerender(
      <ReaderBody
        {...props({ translateView: 'only', sentences: [{ ...s1, translation: null }, s2] })}
      />,
    )
    expect(container.querySelector('article')?.className).toContain('tr-only')
    expect(screen.getByText('（未翻译）')).toBeTruthy()
  })

  it('点击译文等价选中该句；Alt+点击复制译文', () => {
    const onSelectSentence = vi.fn()
    const onAltCopyText = vi.fn()
    render(
      <ReaderBody
        {...props({ translateView: 'below', onSelectSentence, onAltCopyText })}
      />,
    )
    const tr = screen.getByText('跑快点。')
    fireEvent.click(tr)
    expect(onSelectSentence).toHaveBeenCalledWith('s1')
    fireEvent.click(tr, { altKey: true })
    expect(onAltCopyText).toHaveBeenCalledWith('跑快点。')
  })

  it('语言点摘要统计句数；逐条展示结构/语法/习语/词组/用法与手动标记', () => {
    const onAddPhrase = vi.fn()
    const withLang = sentenceFixture('s1', 'Run fast.', {
      translation: '跑快点。',
      languages: [
        {
          structure: 'SV',
          grammar: '一般现在时',
          idioms: ['run fast'],
          phrases: ['run into'],
          usage: ['run a business'],
          source: 'manual',
        },
      ],
    })
    const { container } = render(
      <ReaderBody {...props({ sentences: [withLang, s2], showLanguage: true, onAddPhrase })} />,
    )
    expect(screen.getByText(/本篇 1 句/)).toBeTruthy()
    expect(container.querySelectorAll('.lang-block')).toHaveLength(1)
    expect(screen.getByText('手动')).toBeTruthy()
    expect(screen.getByText('结构：SV')).toBeTruthy()
    expect(screen.getByText('语法：一般现在时')).toBeTruthy()
    expect(screen.getByText('用法：run a business')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /run fast/ }))
    expect(onAddPhrase).toHaveBeenCalledWith(['run fast'], withLang)
  })

  it('没传 onAddPhrase 时语言点词组不可点（禁用）', () => {
    const withLang = sentenceFixture('s1', 'Run fast.', {
      languages: [{ phrases: ['run into'], source: 'ai' }],
    })
    render(<ReaderBody {...props({ sentences: [withLang], showLanguage: true })} />)
    expect((screen.getByRole('button', { name: 'run into' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
