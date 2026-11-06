// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ModalShell from './ModalShell'

describe('ModalShell：弹层语义与键盘', () => {
  it('role=dialog / aria-modal / 标题；打开聚焦，Esc 关闭', () => {
    const onClose = vi.fn()
    render(
      <ModalShell title="测试弹层" onClose={onClose}>
        <button>确定</button>
      </ModalShell>,
    )
    const dialog = screen.getByRole('dialog', { name: '测试弹层' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '确定' }))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('busy 时 Esc 不关', () => {
    const onClose = vi.fn()
    render(
      <ModalShell title="跑批" onClose={onClose} busy>
        <button>取消</button>
      </ModalShell>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Tab 在首尾之间循环', () => {
    render(
      <ModalShell title="循环" onClose={() => {}}>
        <button>第一个</button>
        <button>最后一个</button>
      </ModalShell>,
    )
    const first = screen.getByRole('button', { name: '第一个' })
    const last = screen.getByRole('button', { name: '最后一个' })
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    first.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })
})
