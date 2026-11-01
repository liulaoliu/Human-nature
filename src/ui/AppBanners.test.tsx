// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AppBanners } from './AppBanners'

const base = {
  notice: null,
  onDismissNotice: () => {},
  lowMic: false,
  onDismissLowMic: () => {},
  status: 'empty' as const,
  error: null,
}

describe('AppBanners', () => {
  it('notice 可关闭', () => {
    const onDismissNotice = vi.fn()
    render(<AppBanners {...base} notice="已导出" onDismissNotice={onDismissNotice} />)
    expect(screen.getByText('已导出')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '知道了' }))
    expect(onDismissNotice).toHaveBeenCalled()
  })

  it('低电平提示单独一条，也能关', () => {
    const onDismissLowMic = vi.fn()
    render(<AppBanners {...base} lowMic onDismissLowMic={onDismissLowMic} />)
    expect(screen.getByText(/麦克风电平很低/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '知道了' }))
    expect(onDismissLowMic).toHaveBeenCalled()
  })

  it('loading / error 三态', () => {
    const { rerender } = render(<AppBanners {...base} status="loading" />)
    expect(screen.getByText('解码中…')).toBeTruthy()

    rerender(<AppBanners {...base} status="error" error="坏文件" />)
    expect(screen.getByText('打不开：坏文件')).toBeTruthy()

    rerender(<AppBanners {...base} status="ready" error="保存失败" />)
    expect(screen.getByText('保存失败')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
  })
})
