// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import LangPhrases from './LangPhrases'

describe('LangPhrases', () => {
  it('空列表不渲染', () => {
    const { container } = render(<LangPhrases label="词组" items={[]} onAdd={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('可加入时每条带「＋」，点单条传单条，点全部传全部', () => {
    const onAdd = vi.fn()
    render(<LangPhrases label="习语" items={['run fast', 'walk slow']} onAdd={onAdd} />)
    expect(screen.getByText('习语：')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /run fast/ }))
    expect(onAdd).toHaveBeenCalledWith(['run fast'])
    fireEvent.click(screen.getByRole('button', { name: '全部 ＋' }))
    expect(onAdd).toHaveBeenCalledWith(['run fast', 'walk slow'])
  })

  it('点击不冒泡到外层（避免触发展开/收起）', () => {
    const onAdd = vi.fn()
    const outer = vi.fn()
    render(
      <div onClick={outer}>
        <LangPhrases label="词组" items={['a', 'b']} onAdd={onAdd} />
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: /a/ }))
    expect(outer).not.toHaveBeenCalled()
  })

  it('没有 onAdd 时按钮禁用且不显示「＋」/全部', () => {
    render(<LangPhrases label="词组" items={['a']} />)
    expect((screen.getByRole('button', { name: 'a' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText('全部 ＋')).toBeNull()
  })

  it('只有一条时不显示「全部」', () => {
    render(<LangPhrases label="词组" items={['a']} onAdd={vi.fn()} />)
    expect(screen.queryByText('全部 ＋')).toBeNull()
  })
})
