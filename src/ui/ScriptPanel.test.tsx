// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ScriptPanel from './ScriptPanel'
import type { AlignedChunk } from '../core/alignText'

const ALIGNED: AlignedChunk[] = [
  { index: 0, text: 'one two', wordRange: [0, 2] },
  { index: 1, text: 'three four', wordRange: [2, 4] },
]

type Props = Parameters<typeof ScriptPanel>[0]

function setup(over: Partial<Props> = {}) {
  const props: Props = {
    script: 'one two three four',
    scriptSource: 'auto',
    scriptLibrary: true,
    offsetWords: 0,
    textStartChunk: 0,
    manualAnchors: 0,
    manualRanges: [],
    aligned: ALIGNED,
    current: 0,
    editing: false,
    viewMode: 'full',
    onViewMode: vi.fn(),
    onToggle: vi.fn(),
    onSubmit: vi.fn(),
    onPickWords: vi.fn(),
    onNudgeAnchor: vi.fn(),
    onClearAnchorHere: vi.fn(),
    onClearAnchors: vi.fn(),
    ...over,
  }
  const view = render(<ScriptPanel {...props} />)
  return { props, ...view }
}

describe('ScriptPanel', () => {
  it('还没原文时给「粘上原文」入口', () => {
    const { props } = setup({ script: '', aligned: [] })
    fireEvent.click(screen.getByRole('button', { name: /粘上原文/ }))
    expect(props.onToggle).toHaveBeenCalled()
  })

  it('原文库没取到要说清是请求失败，而不是「库里没这篇」', () => {
    setup({ script: '', aligned: [], scriptLibrary: false })
    expect(screen.getByText(/articles\.json 请求失败/)).toBeTruthy()
  })

  it('把各块文字摊出来，当前块标 here、邻块标 near', () => {
    const { container } = setup()
    expect(container.textContent).toContain('one two')
    expect(container.textContent).toContain('three four')
    expect(container.querySelectorAll('.seg.here')).toHaveLength(1)
    expect(container.querySelectorAll('.seg.near')).toHaveLength(1)
  })

  it('显示模式按钮显示当前值，点了回传下一个模式', () => {
    const { props } = setup({ viewMode: 'focus' })
    fireEvent.click(screen.getByRole('button', { name: /显示：聚焦/ }))
    expect(props.onViewMode).toHaveBeenCalledWith('block')
  })

  it('编辑态：带出已有文本，Ctrl+Enter 提交草稿', () => {
    const { props } = setup({ editing: true })
    const ta = screen.getByPlaceholderText(/把这一篇的原文粘进来/) as HTMLTextAreaElement
    expect(ta.value).toBe('one two three four')
    fireEvent.change(ta, { target: { value: 'one two three four five' } })
    fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true })
    expect(props.onSubmit).toHaveBeenCalledWith('one two three four five')
  })

  it('编辑态按 Esc 关掉编辑', () => {
    const { props } = setup({ editing: true })
    fireEvent.keyDown(screen.getByPlaceholderText(/把这一篇的原文粘进来/), { key: 'Escape' })
    expect(props.onToggle).toHaveBeenCalled()
  })

  it('当前块已锚定时显示词范围，微调按钮回传方向', () => {
    const { props } = setup({ manualAnchors: 1, manualRanges: [{ atSec: 0, chunkIndex: 0, startWord: 0, endWord: 2 }] })
    expect(screen.getByText(/第 1 块已锚定：词 1–2/)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: '−' })[0])
    expect(props.onNudgeAnchor).toHaveBeenCalledWith('start', -1)
    fireEvent.click(screen.getAllByRole('button', { name: '＋' })[1])
    expect(props.onNudgeAnchor).toHaveBeenCalledWith('end', 1)
  })

  it('有锚点时能清空，且要手打 Delete 才确认', () => {
    const { props } = setup({ manualAnchors: 2, manualRanges: [] })
    fireEvent.click(screen.getByRole('button', { name: /清除全部锚定（2）/ }))
    const confirm = screen.getByRole('button', { name: '确认清除' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('Delete'), { target: { value: 'Delete' } })
    fireEvent.click(screen.getByRole('button', { name: '确认清除' }))
    expect(props.onClearAnchors).toHaveBeenCalled()
  })
})
