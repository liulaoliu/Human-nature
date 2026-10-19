// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import SpeedReadSentence, { type SpeedReadSentenceProps } from './SpeedReadSentence'
import { sentenceFixture } from '../../core/testFixtures'

function props(over: Partial<SpeedReadSentenceProps> = {}): SpeedReadSentenceProps {
  return {
    sentence: sentenceFixture('s1', 'They abandon it.', { translation: '他们放弃了它。' }),
    phase: 'read',
    sentenceParts: <span>They abandon it.</span>,
    over: false,
    words: 3,
    target: 2000,
    elapsed: 0,
    pace: 0,
    pickMode: false,
    vocabMode: false,
    autoDrill: false,
    drill: null,
    picked: '',
    drillOk: null,
    readMs: 0,
    slow: false,
    selWords: [],
    addedWord: '',
    wordDraft: '',
    knownWords: [],
    confirmDel: null,
    ttsState: 'idle',
    onAddPhrases: vi.fn(),
    addSelected: vi.fn(),
    mergePhrase: vi.fn(),
    setWordDraft: vi.fn(),
    addCustom: vi.fn(),
    tapRemove: vi.fn(),
    advance: vi.fn(),
    onClose: vi.fn(),
    onSpeak: vi.fn(),
    chooseDrill: vi.fn(),
    ...over,
  }
}

describe('SpeedReadSentence', () => {
  it('阅读阶段显示正文，读完按钮推进', () => {
    const advance = vi.fn()
    render(<SpeedReadSentence {...props({ advance })} />)
    expect(screen.getByText('They abandon it.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '读完了（空格）' }))
    expect(advance).toHaveBeenCalled()
  })

  it('揭示阶段显示译文，超时且无题时直接下一句', () => {
    render(<SpeedReadSentence {...props({ phase: 'reveal', slow: true })} />)
    expect(screen.getByText('他们放弃了它。')).toBeTruthy()
    expect(screen.getByRole('button', { name: '下一句（空格）' })).toBeTruthy()
  })

  it('拷打阶段隐藏原文提示，选项回传', () => {
    const chooseDrill = vi.fn()
    const drill = {
      prompt: 'They ____ it.',
      answer: 'abandon',
      accept: ['abandon'],
      via: 'vocab' as const,
      options: ['abandon', 'benefit'],
    }
    render(<SpeedReadSentence {...props({ phase: 'drill', drill, chooseDrill })} />)
    expect(screen.getByText('原文已隐藏 —— 只看挖空句，从选项里选')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /benefit/ }))
    expect(chooseDrill).toHaveBeenCalledWith('benefit')
  })
})
