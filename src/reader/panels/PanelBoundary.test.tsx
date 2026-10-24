// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import PanelBoundary from './PanelBoundary'

/**
 * P2-9 回归：懒加载面板抛错时只能坏这一块，不能把阅读页整棵打白。
 * 同时保证「关闭」走宿主回调（路由 replace），「重试」能清掉错误态。
 */
afterEach(() => {
  vi.restoreAllMocks()
})

describe('PanelBoundary', () => {
  it('子组件抛错 → 显示面板名与两个出口，不把异常冒出去', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onClose = vi.fn()
    const Boom = () => {
      throw new Error('chunk load failed')
    }
    render(
      <PanelBoundary name="速读" onClose={onClose}>
        <Boom />
      </PanelBoundary>,
    )
    expect(screen.getByRole('alert').textContent).toContain('速读加载失败')
    fireEvent.click(screen.getByText('关闭'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('重试：清掉错误态并调用注入的重试回调', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let boom = true
    const Child = () => {
      if (boom) throw new Error('temporary')
      return <div>面板回来了</div>
    }
    render(
      <PanelBoundary
        name="计划"
        onClose={() => {}}
        onRetry={() => {
          boom = false
        }}
      >
        <Child />
      </PanelBoundary>,
    )
    fireEvent.click(screen.getByText('重试'))
    expect(await screen.findByText('面板回来了')).toBeTruthy()
  })
})
