// @vitest-environment jsdom
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ReaderShell from './ReaderShell'

vi.mock('../ui/FishLayer', () => ({ default: () => <div data-testid="fish" /> }))

/**
 * 阅读页外壳只做布局。这里钉住：
 * 三个 slot 的顺序（工具栏 → 正文 → 侧栏）、页级皮肤 class、鼠标事件仍绑在 main、toast 只在有内容时出现。
 */
describe('ReaderShell', () => {
  function setup(over: Partial<Parameters<typeof ReaderShell>[0]> = {}) {
    const onMouseDown = vi.fn()
    const onMouseUp = vi.fn()
    const onContextMenu = vi.fn()
    const sideRef = createRef<HTMLElement>()
    const utils = render(
      <ReaderShell
        fontSize="lg"
        bold
        serif
        examActive
        studying
        sideTab="vocab"
        sideRef={sideRef}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onContextMenu={onContextMenu}
        toast=""
        toolbar={<div>toolbar</div>}
        sidebar={<div>sidebar</div>}
        {...over}
      >
        <div>body</div>
      </ReaderShell>,
    )
    return { ...utils, onMouseDown, onMouseUp, onContextMenu, sideRef }
  }

  it('按 工具栏 → 正文 → 侧栏 的顺序渲染，并带页级 class', () => {
    const { container, sideRef } = setup()
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toBe('reader size-lg weight-bold font-serif exam studying')

    const main = container.querySelector('main.reader-main') as HTMLElement
    const toolbar = screen.getByText('toolbar')
    const body = screen.getByText('body')
    expect(main.contains(toolbar)).toBe(true)
    expect(main.contains(body)).toBe(true)
    expect(toolbar.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const aside = container.querySelector('aside') as HTMLElement
    expect(aside.className).toBe('reader-side tab-vocab')
    expect(aside).toBe(sideRef.current)
    expect(aside.textContent).toContain('sidebar')
  })

  it('鼠标事件绑在 main 上', () => {
    const { container, onMouseDown, onMouseUp, onContextMenu } = setup()
    const main = container.querySelector('main.reader-main') as HTMLElement
    fireEvent.mouseDown(main)
    fireEvent.mouseUp(main)
    fireEvent.contextMenu(main)
    expect(onMouseDown).toHaveBeenCalledTimes(1)
    expect(onMouseUp).toHaveBeenCalledTimes(1)
    expect(onContextMenu).toHaveBeenCalledTimes(1)
  })

  it('toast 有内容才出现', () => {
    const { rerender, container } = setup()
    expect(container.querySelector('.toast')).toBeNull()
    rerender(
      <ReaderShell
        fontSize="md"
        bold={false}
        serif={false}
        examActive={false}
        studying={false}
        sideTab="overview"
        sideRef={createRef<HTMLElement>()}
        onMouseDown={vi.fn()}
        onMouseUp={vi.fn()}
        onContextMenu={vi.fn()}
        toast="已保存"
        sidebar={null}
      >
        {null}
      </ReaderShell>,
    )
    expect(screen.getByText('已保存').className).toBe('toast')
  })
})
