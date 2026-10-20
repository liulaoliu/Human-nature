// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { sentenceFixture } from '../../core/testFixtures'
import LanguageEditor, { type LanguageEditorProps } from './LanguageEditor'

const sentence = sentenceFixture('s1', 'Run fast.', {
  language: { structure: 'SV' },
  languages: [
    { structure: 'SV', grammar: '一般现在时', source: 'ai', at: '2026-10-01T00:00:00.000Z' },
    { idioms: ['run fast'], source: 'manual', at: '2026-10-02T00:00:00.000Z' },
  ],
})

function props(over: Partial<LanguageEditorProps> = {}): LanguageEditorProps {
  return { sentence, onSave: vi.fn(), onClose: vi.fn(), ...over }
}

describe('LanguageEditor：已有语言点', () => {
  it('列出多条并区分 AI / 手动；显示句子与条数', () => {
    render(<LanguageEditor {...props()} />)
    expect(screen.getByText('语言点（2）')).toBeTruthy()
    expect(screen.getByText('Run fast.')).toBeTruthy()
    expect(screen.getByText('AI')).toBeTruthy()
    expect(screen.getByText('手动')).toBeTruthy()
    expect(screen.getAllByText(/一般现在时/).length).toBeGreaterThan(0)
  })

  it('编辑一条：表单回填，保存后保留来源', () => {
    const { container } = render(<LanguageEditor {...props()} />)
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0])
    expect((screen.getByDisplayValue('SV') as HTMLInputElement).value).toBe('SV')
    fireEvent.change(screen.getByDisplayValue('一般现在时'), { target: { value: '现在进行时' } })
    fireEvent.click(screen.getByRole('button', { name: '保存本条' }))
    expect(screen.getByText(/现在进行时/)).toBeTruthy()
    expect(container.querySelectorAll('.lang-item')).toHaveLength(2)
    // 来源仍是 AI
    expect(screen.getAllByText('AI')).toHaveLength(1)
  })

  it('删除一条后条数同步', () => {
    const { container } = render(<LanguageEditor {...props()} />)
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[1])
    expect(screen.getByText('语言点（1）')).toBeTruthy()
    expect(container.querySelectorAll('.lang-item')).toHaveLength(1)
  })
})

describe('LanguageEditor：新增与保存', () => {
  it('表单全空时「加入列表」不新增', () => {
    const { container } = render(<LanguageEditor {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '＋ 加入列表' }))
    expect(container.querySelectorAll('.lang-item')).toHaveLength(2)
  })

  it('新增一条：列表/去重（分号分隔）/来源标记为手动', () => {
    const { container } = render(<LanguageEditor {...props()} />)
    fireEvent.change(screen.getByPlaceholderText(/句子主干/), { target: { value: 'SVO' } })
    fireEvent.change(screen.getAllByPlaceholderText(/多个用「；」分隔/)[0], { target: { value: 'a；b; a' } })
    fireEvent.click(screen.getByRole('button', { name: '＋ 加入列表' }))
    expect(screen.getByText('语言点（3）')).toBeTruthy()
    expect(container.querySelectorAll('.lang-item')).toHaveLength(3)
    expect(screen.getAllByText('手动')).toHaveLength(2)
    // 表单清空，回到「新增一条」
    expect(screen.getByText('＋ 新增一条')).toBeTruthy()
  })

  it('保存时把「正在填但没加入列表」的内容一并写回', () => {
    const onSave = vi.fn()
    render(<LanguageEditor {...props({ onSave })} />)
    fireEvent.change(screen.getByPlaceholderText(/时态/), { target: { value: '虚拟语气' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    const langs = onSave.mock.calls[0][0]
    expect(langs).toHaveLength(3)
    expect(langs[2]).toMatchObject({ grammar: '虚拟语气', source: 'manual' })
  })

  it('没有语言点的句子从空列表开始；保存空列表传 []', () => {
    const onSave = vi.fn()
    render(
      <LanguageEditor
        {...props({ sentence: sentenceFixture('s2', 'Hello.'), onSave })}
      />,
    )
    expect(screen.getByText('语言点（0）')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onSave).toHaveBeenCalledWith([])
  })
})

describe('LanguageEditor：关闭', () => {
  it('点遮罩关闭；点面板本身不关闭；取消按钮关闭', () => {
    const onClose = vi.fn()
    const { container } = render(<LanguageEditor {...props({ onClose })} />)
    fireEvent.click(screen.getByText('语言点（2）'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(container.querySelector('.lang-editor-overlay') as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
