// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import RoundSizeSelect from './RoundSizeSelect'

describe('RoundSizeSelect：通用本轮数量下拉', () => {
  it('按 options 显示档位，0 显示「全部」，改动回调数字', () => {
    const onChange = vi.fn()
    render(<RoundSizeSelect ariaLabel="本轮题数" value={10} options={[5, 10, 20, 0]} onChange={onChange} />)
    const select = screen.getByLabelText('本轮题数') as HTMLSelectElement
    expect(select.value).toBe('10')
    expect(screen.getByRole('option', { name: '全部' })).toBeTruthy()
    fireEvent.change(select, { target: { value: '0' } })
    expect(onChange).toHaveBeenCalledWith(0)
  })

  it('当前值不在档位里也保留（恢复的旧会话不会变空白）', () => {
    render(<RoundSizeSelect ariaLabel="本轮题数" value={25} options={[5, 10, 20]} onChange={vi.fn()} />)
    expect((screen.getByLabelText('本轮题数') as HTMLSelectElement).value).toBe('25')
    expect(screen.getByRole('option', { name: '25 题' })).toBeTruthy()
  })

  it('支持自定义文字 / 单位 / 禁用', () => {
    const { rerender } = render(
      <RoundSizeSelect
        ariaLabel="每轮题数"
        value={10}
        options={[0, 10]}
        onChange={vi.fn()}
        formatLabel={(n) => (n === 0 ? '不限题数' : `每轮 ${n} 题`)}
      />,
    )
    expect(screen.getByRole('option', { name: '每轮 10 题' })).toBeTruthy()
    expect(screen.getByRole('option', { name: '不限题数' })).toBeTruthy()

    rerender(
      <RoundSizeSelect ariaLabel="每轮题数" value={10} options={[0, 10]} onChange={vi.fn()} disabled />,
    )
    expect((screen.getByLabelText('每轮题数') as HTMLSelectElement).disabled).toBe(true)
  })
})
