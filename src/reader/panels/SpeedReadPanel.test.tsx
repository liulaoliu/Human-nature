// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { sentenceFixture } from '../../core/testFixtures'
import { installFakeStorage } from '../testStorage'
import SpeedReadPanel, { type SpeedReadPanelProps } from './SpeedReadPanel'

const sentences = [
  sentenceFixture('s1', 'Run fast.', { translation: '跑快点。' }),
  sentenceFixture('s2', 'Walk slow.', { translation: '走慢点。' }),
]

function props(over: Partial<SpeedReadPanelProps> = {}): SpeedReadPanelProps {
  const noop = vi.fn()
  return {
    sentences,
    docKey: 'doc:1',
    onClose: noop,
    onSpeak: noop,
    ttsState: 'idle',
    onAddItems: noop,
    isKnown: () => false,
    wordMeaning: () => null,
    onFinishRead: noop,
    onAddPhrases: noop,
    onHint: noop,
    wordsInSentence: () => [],
    onRemoveWord: noop,
    vocabMode: false,
    onOpenLang: noop,
    langEditorOpen: false,
    ...over,
  }
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

describe('SpeedReadPanel：逐句阅读', () => {
  it('显示进度；前后翻句走 go；结束按钮回调', () => {
    const onClose = vi.fn()
    render(<SpeedReadPanel {...props({ onClose })} />)
    expect(screen.getByText('第 1 / 2 句')).toBeTruthy()

    fireEvent.click(screen.getByTitle('下一句（→）'))
    expect(screen.getByText('第 2 / 2 句')).toBeTruthy()
    fireEvent.click(screen.getByTitle('上一句（←）'))
    expect(screen.getByText('第 1 / 2 句')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '结束（Esc）' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('空格揭示译文，再空格进入下一句', () => {
    render(<SpeedReadPanel {...props()} />)
    expect(screen.queryByText('跑快点。')).toBeNull()

    fireEvent.keyDown(window, { key: ' ' })
    expect(screen.getByText('跑快点。')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '下一句（空格）' }))
    expect(screen.getByText('第 2 / 2 句')).toBeTruthy()
    expect(screen.queryByText('跑快点。')).toBeNull()
  })

  it('读完所有句 → 结算，并且 onFinishRead 只回调一次', async () => {
    const onFinishRead = vi.fn()
    render(<SpeedReadPanel {...props({ onFinishRead })} />)

    fireEvent.click(screen.getByRole('button', { name: '读完了（空格）' }))
    fireEvent.click(screen.getByRole('button', { name: '下一句（空格）' }))
    expect(screen.getByText('第 2 / 2 句')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '读完了（空格）' }))
    fireEvent.click(screen.getByRole('button', { name: '下一句（空格）' }))
    expect(screen.getByText('完成')).toBeTruthy()
    expect(screen.getByText(/读完/)).toBeTruthy()
    await waitFor(() => expect(onFinishRead).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: '再来一遍' }))
    expect(screen.getByText('第 1 / 2 句')).toBeTruthy()
  })

  it('超时 + 自动拷打：揭示后先做题，答完才进下一句', () => {
    vi.useFakeTimers()
    render(<SpeedReadPanel {...props()} />)
    // 'Run fast.' 在默认 WPM 下目标远小于 2 秒
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    fireEvent.click(screen.getByRole('button', { name: '读完了（空格）' }))
    expect(screen.getByText(/超时了，先来一道/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '来一道（空格）' }))
    expect(screen.getByText('拷打：把空填回来')).toBeTruthy()
    // 原文隐藏，只留挖空句
    expect(screen.getByText(/原文已隐藏/)).toBeTruthy()

    const options = screen.getAllByRole('button').filter((b) => b.querySelector('kbd'))
    expect(options.length).toBeGreaterThan(1)
    fireEvent.click(options[0])

    // 答对会自动下一句（650ms），答错要按空格；两种情况都不应留在 drill
    const next = screen.queryByRole('button', { name: '下一句（空格）' })
    if (next) {
      fireEvent.click(next)
    } else {
      act(() => {
        vi.advanceTimersByTime(700)
      })
    }
    expect(screen.getByText('第 2 / 2 句')).toBeTruthy()
  })
})

describe('SpeedReadPanel：加词与移出', () => {
  it('选词模式：没开只提示；开了点词 → 加入清单并落盘', () => {
    const onAddItems = vi.fn()
    const onHint = vi.fn()
    const onClose = vi.fn()
    render(<SpeedReadPanel {...props({ onAddItems, onHint, onClose })} />)

    expect((screen.getByRole('button', { name: /加入清单/ }) as HTMLButtonElement).disabled).toBe(true)

    // 没开选词模式：点词只提示
    fireEvent.click(screen.getByText('Run'))
    expect(onHint).toHaveBeenCalledWith('先勾上顶栏「选词模式」才能点选 / 右键入库')

    fireEvent.click(screen.getByLabelText('选词模式'))
    fireEvent.click(screen.getByText('Run'))
    const add = screen.getByRole('button', { name: '＋ 加入清单（1）' })
    expect((add as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(add)

    expect(onAddItems).toHaveBeenCalledWith([
      { word: 'Run', sentenceId: 's1', sentenceText: 'Run fast.' },
    ])
    expect(screen.getByText(/已加入：Run/)).toBeTruthy()
    expect(screen.getByText('本页加入（1）')).toBeTruthy()
    const saved = JSON.parse(localStorage.getItem('reader:speedCollected:doc:1') ?? '[]')
    expect(saved).toHaveLength(1)
    expect(saved[0].word).toBe('Run')
  })

  it('手打词回车加入；空串不动作', () => {
    const onAddItems = vi.fn()
    render(<SpeedReadPanel {...props({ onAddItems })} />)
    const input = screen.getByPlaceholderText('也可手打词 / 词组，回车加入')
    const add = screen.getByRole('button', { name: '加入' }) as HTMLButtonElement
    expect(add.disabled).toBe(true)

    fireEvent.change(input, { target: { value: 'swift' } })
    expect(add.disabled).toBe(false)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onAddItems).toHaveBeenCalledWith([{ word: 'swift', sentenceId: 's1', sentenceText: 'Run fast.' }])
    expect((input as HTMLInputElement).value).toBe('')

    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onAddItems).toHaveBeenCalledTimes(1)
  })

  it('本句已在生词本的词：点两下才移出', () => {
    const onRemoveWord = vi.fn()
    render(
      <SpeedReadPanel
        {...props({ isKnown: (w) => w.toLowerCase() === 'run', onRemoveWord })}
      />,
    )
    expect(screen.getByText(/本句已在生词本/)).toBeTruthy()
    const chip = screen.getByRole('button', { name: 'Run' })
    fireEvent.click(chip)
    expect(onRemoveWord).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认移出「Run」' }))
    expect(onRemoveWord).toHaveBeenCalledWith('Run')
  })

  it('本页清单里的误加词：两步删除并同步移出生词本', () => {
    localStorage.setItem(
      'reader:speedCollected:doc:1',
      JSON.stringify([{ word: 'typo', sentenceId: 's0', sentenceText: 'Typo here.' }]),
    )
    const onRemoveWord = vi.fn()
    render(<SpeedReadPanel {...props({ onRemoveWord })} />)
    expect(screen.getByText('本页加入（1）')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '从生词本移出 typo' }))
    expect(onRemoveWord).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认移出 typo' }))
    expect(onRemoveWord).toHaveBeenCalledWith('typo')
    expect(screen.queryByText('本页加入（1）')).toBeNull()
  })
})

describe('SpeedReadPanel：键盘与空数据', () => {
  it('←/→/w/a/d/Esc 快捷键；输入框内不抢键', () => {
    const onClose = vi.fn()
    render(<SpeedReadPanel {...props({ onClose })} />)

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('第 2 / 2 句')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByText('第 1 / 2 句')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'd' })
    expect(screen.getByText('第 2 / 2 句')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'a' })
    expect(screen.getByText('第 1 / 2 句')).toBeTruthy()

    const input = screen.getByPlaceholderText('也可手打词 / 词组，回车加入')
    fireEvent.keyDown(input, { key: 'ArrowRight' })
    expect(screen.getByText('第 1 / 2 句')).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('语言点编辑器打开时不抢键盘', () => {
    render(<SpeedReadPanel {...props({ langEditorOpen: true })} />)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('第 1 / 2 句')).toBeTruthy()
  })

  it('没有句子时不崩，直接显示结算', () => {
    render(<SpeedReadPanel {...props({ sentences: [] })} />)
    expect(screen.getByText('完成')).toBeTruthy()
    expect(screen.queryByText('读完了（空格）')).toBeNull()
  })
})
