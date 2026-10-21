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
    expect((screen.getByDisplayValue('SV') as HTMLTextAreaElement).value).toBe('SV')
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

describe('LanguageEditor：旧数据兼容', () => {
  it('只有单条 language（老结构）也能回填、编辑、保存', () => {
    const onSave = vi.fn()
    const legacy = sentenceFixture('s9', 'Old style.', {
      language: { structure: '旧结构', grammar: '旧语法', idioms: ['run fast'], usage: ['旧用法'] },
    })
    render(<LanguageEditor sentence={legacy} onSave={onSave} onClose={vi.fn()} />)
    expect(screen.getByText('语言点（1）')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect((screen.getByDisplayValue('旧结构') as HTMLTextAreaElement).value).toBe('旧结构')
    fireEvent.change(screen.getByDisplayValue('旧结构'), { target: { value: '新结构\n第二行' } })
    fireEvent.click(screen.getByRole('button', { name: '保存本条' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onSave.mock.calls[0][0][0]).toMatchObject({
      structure: '新结构\n第二行',
      grammar: '旧语法',
      idioms: ['run fast'],
      usage: ['旧用法'],
      source: 'ai',
    })
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
    fireEvent.change(screen.getAllByPlaceholderText(/多个用「；」/)[0], { target: { value: 'a；b; a' } })
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

  it('五个字段都是可换行的 textarea；多行内容按换行拆成多条', () => {
    const onSave = vi.fn()
    const { container } = render(<LanguageEditor {...props({ onSave })} />)
    expect(container.querySelectorAll('.lang-form textarea')).toHaveLength(5)
    expect(container.querySelectorAll('.lang-form input')).toHaveLength(0)
    fireEvent.change(screen.getByPlaceholderText(/句子主干/), { target: { value: 'SVO\n（主句）' } })
    fireEvent.change(screen.getAllByPlaceholderText(/多个用「；」/)[0], { target: { value: 'run fast\nwalk slow' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    const langs = onSave.mock.calls[0][0]
    expect(langs[2]).toMatchObject({ structure: 'SVO\n（主句）', idioms: ['run fast', 'walk slow'], source: 'manual' })
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

describe('LanguageEditor：点输入框展开 / 点框外收回', () => {
  it('聚焦哪个字段哪个字段展开；点标题或遮罩恢复原高度，切换字段跟着换', () => {
    const { container } = render(<LanguageEditor {...props()} />)
    const editor = container.querySelector('.lang-editor') as HTMLElement
    const structure = screen.getByPlaceholderText(/句子主干/)
    const grammar = screen.getByPlaceholderText(/时态/)

    fireEvent.focus(structure)
    expect(editor.className).toContain('expanded')
    expect((structure.closest('label') as HTMLElement).className).toContain('expanded')

    fireEvent.click(screen.getByText('语言点（2）'))
    expect(editor.className).not.toContain('expanded')
    expect((structure.closest('label') as HTMLElement).className).not.toContain('expanded')

    fireEvent.focus(grammar)
    expect(editor.className).toContain('expanded')
    expect((grammar.closest('label') as HTMLElement).className).toContain('expanded')

    fireEvent.click(container.querySelector('.lang-editor-overlay') as HTMLElement)
    expect(editor.className).not.toContain('expanded')
  })
})

describe('LanguageEditor：关闭', () => {
  it('点遮罩 / 点面板都不关闭；只有「取消」关闭（保存由调用方关）', () => {
    const onClose = vi.fn()
    const onSave = vi.fn()
    const { container } = render(<LanguageEditor {...props({ onClose, onSave })} />)
    fireEvent.click(container.querySelector('.lang-editor-overlay') as HTMLElement)
    fireEvent.click(screen.getByText('语言点（2）'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})
