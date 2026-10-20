// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import SpeedReadBasket, { SpeedReadDone } from './SpeedReadBasket'

describe('SpeedReadBasket', () => {
  it('清单为空时不渲染', () => {
    const { container } = render(
      <SpeedReadBasket
        collected={[]}
        collectedOpen
        showCollected
        confirmIdx={null}
        onToggleOpen={vi.fn()}
        onShowChange={vi.fn()}
        onTapDelete={vi.fn()}
      />,
    )
    expect(container.textContent).toBe('')
  })

  it('列出词与来源句，删除按钮回传下标', () => {
    const onTapDelete = vi.fn()
    render(
      <SpeedReadBasket
        collected={[{ word: 'abandon', sentenceId: 's1', sentenceText: 'They abandon it.' }]}
        collectedOpen
        showCollected
        confirmIdx={null}
        onToggleOpen={vi.fn()}
        onShowChange={vi.fn()}
        onTapDelete={onTapDelete}
      />,
    )
    expect(screen.getByText('abandon')).toBeTruthy()
    expect(screen.getByText('They abandon it.')).toBeTruthy()
    // 标签带词：多行清单里读屏能分清移出哪条
    fireEvent.click(screen.getByRole('button', { name: '从生词本移出 abandon' }))
    expect(onTapDelete).toHaveBeenCalledWith(0)
  })

  it('取消「显示已加入」时给出空态提示', () => {
    render(
      <SpeedReadBasket
        collected={[{ word: 'abandon', sentenceId: 's1', sentenceText: '' }]}
        collectedOpen
        showCollected={false}
        confirmIdx={null}
        onToggleOpen={vi.fn()}
        onShowChange={vi.fn()}
        onTapDelete={vi.fn()}
      />,
    )
    expect(screen.getByText(/已加入的单词已隐藏/)).toBeTruthy()
  })
})

describe('SpeedReadDone', () => {
  it('显示结算数据，按钮回传动作', () => {
    const onRestart = vi.fn()
    const onClose = vi.fn()
    render(
      <SpeedReadDone
        summary={{ count: 8, avgWpm: 210, slow: 2, drillTotal: 3, drillCorrect: 2 }}
        onRestart={onRestart}
        onClose={onClose}
      />,
    )
    expect(screen.getByText(/读完/).textContent).toContain('8')
    expect(screen.getByText(/拷打对/).textContent).toContain('2/3')
    fireEvent.click(screen.getByRole('button', { name: '再来一遍' }))
    fireEvent.click(screen.getByRole('button', { name: '回到阅读' }))
    expect(onRestart).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
