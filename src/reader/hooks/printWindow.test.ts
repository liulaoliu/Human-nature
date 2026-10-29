// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { openPrintWindow } from './printWindow'

function fakeWin() {
  const doc = { write: vi.fn(), close: vi.fn(), title: '' }
  return { document: doc } as unknown as Window
}

describe('openPrintWindow', () => {
  it('打开新窗口、写入 HTML、关文档并设标题', () => {
    const win = fakeWin()
    const open = vi.spyOn(window, 'open').mockReturnValue(win)
    expect(openPrintWindow('<html>x</html>', '全库金句本')).toBe(true)
    expect(open).toHaveBeenCalledWith('', '_blank')
    expect(win.document.write).toHaveBeenCalledWith('<html>x</html>')
    expect(win.document.close).toHaveBeenCalled()
    expect(win.document.title).toBe('全库金句本')
    open.mockRestore()
  })

  it('弹窗被拦截：返回 false，调用方负责提示', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    expect(openPrintWindow('<html/>', 'x')).toBe(false)
    open.mockRestore()
  })

  it('窗口提前关闭导致设标题失败也不抛', () => {
    const win = fakeWin()
    Object.defineProperty(win.document, 'title', {
      set() {
        throw new Error('window closed')
      },
      get: () => '',
    })
    const open = vi.spyOn(window, 'open').mockReturnValue(win)
    expect(() => openPrintWindow('<html/>', 'x')).not.toThrow()
    open.mockRestore()
  })
})
