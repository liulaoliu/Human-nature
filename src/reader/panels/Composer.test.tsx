// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import Composer, { type ComposerProps } from './Composer'

function props(over: Partial<ComposerProps> = {}): ComposerProps {
  const noop = vi.fn()
  return {
    composing: false,
    onCancel: noop,
    title: '',
    onTitleChange: noop,
    book: '',
    onBookChange: noop,
    manual: '',
    onManualChange: noop,
    pdfRange: '',
    onPdfRangeChange: noop,
    importing: '',
    onImportFiles: noop,
    onPickPdf: noop,
    onPickEpub: noop,
    onCleanupPrompt: noop,
    onCreate: noop,
    ...over,
  }
}

describe('Composer', () => {
  it('标题/书名/页码/正文都是受控输入', () => {
    const onTitleChange = vi.fn()
    const onBookChange = vi.fn()
    const onPdfRangeChange = vi.fn()
    const onManualChange = vi.fn()
    render(
      <Composer
        {...props({ onTitleChange, onBookChange, onPdfRangeChange, onManualChange })}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText('文章标题（可留空）'), { target: { value: 'T' } })
    fireEvent.change(screen.getByPlaceholderText('书名（可选，用于分组）'), { target: { value: 'B' } })
    fireEvent.change(screen.getByPlaceholderText('页码范围 14-16（留空=整本）'), { target: { value: '1-2' } })
    fireEvent.change(screen.getByPlaceholderText(/把英文正文粘在这里/), { target: { value: 'Text' } })
    expect(onTitleChange).toHaveBeenCalledWith('T')
    expect(onBookChange).toHaveBeenCalledWith('B')
    expect(onPdfRangeChange).toHaveBeenCalledWith('1-2')
    expect(onManualChange).toHaveBeenCalledWith('Text')
  })

  it('空正文时清洗/创建不可点；有正文才可点', () => {
    const { rerender } = render(<Composer {...props()} />)
    expect((screen.getByRole('button', { name: '生成清洗提示词' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '创建文章' }) as HTMLButtonElement).disabled).toBe(true)

    rerender(<Composer {...props({ manual: 'Hello' })} />)
    expect((screen.getByRole('button', { name: '生成清洗提示词' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: '创建文章' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('三个文件选择器分别把文件交给对应回调', () => {
    const onImportFiles = vi.fn()
    const onPickPdf = vi.fn()
    const onPickEpub = vi.fn()
    const { container } = render(<Composer {...props({ onImportFiles, onPickPdf, onPickEpub })} />)
    const inputs = container.querySelectorAll('input[type=file]')
    const txt = new File(['a'], 'a.txt', { type: 'text/plain' })
    const pdf = new File(['b'], 'b.pdf', { type: 'application/pdf' })
    const epub = new File(['c'], 'c.epub', { type: 'application/epub+zip' })

    fireEvent.change(inputs[0], { target: { files: [txt] } })
    fireEvent.change(inputs[1], { target: { files: [pdf] } })
    fireEvent.change(inputs[2], { target: { files: [epub] } })
    expect(onImportFiles).toHaveBeenCalledWith([txt])
    expect(onPickPdf).toHaveBeenCalledWith(pdf)
    expect(onPickEpub).toHaveBeenCalledWith(epub)
  })

  it('composing 时才显示取消；importing 时显示状态', () => {
    const onCancel = vi.fn()
    const { rerender } = render(<Composer {...props({ onCancel })} />)
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull()

    rerender(<Composer {...props({ composing: true, onCancel, importing: '正在解析 PDF…' })} />)
    expect(screen.getByText('正在解析 PDF…')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
