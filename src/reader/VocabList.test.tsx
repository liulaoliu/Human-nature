// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { vocabItem } from '../core/testFixtures'
import VocabList from './VocabList'

/**
 * 生词列表的无障碍：列表里每条都有一组同名按钮（重来/记得/简单/编辑/删除），
 * 读屏只念「删除 按钮」等于没念。这里钉住每个动作都带上条目本身。
 */
const items = [
  vocabItem({ id: 'w1', word: 'run', lemma: 'run', meaning: '跑' }),
  vocabItem({ id: 'w2', word: 'wall', lemma: 'wall', meaning: '墙' }),
]

function setup(over: Partial<Parameters<typeof VocabList>[0]> = {}) {
  const onDelete = vi.fn()
  const onReview = vi.fn()
  const handlers = {
    onSpeak: vi.fn(),
    onDelete,
    onReview,
    onEdit: vi.fn(),
    onJump: vi.fn(),
  }
  const props = {
    items,
    view: 'card' as const,
    focusLemma: null,
    confirmDel: null,
    ...handlers,
    ...over,
  }
  const view = render(<VocabList {...props} />)
  return { ...handlers, view, props }
}

describe('VocabList：卡片视图的按钮带上词条', () => {
  it('复习三档与编辑/删除都念得出是哪条', () => {
    setup()
    expect(screen.getByRole('button', { name: 'run：重来' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'run：记得' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'run：简单' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '编辑 run' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '删除 run' })).toBeTruthy()
    // 两条词各自一个，不串
    expect(screen.getByRole('button', { name: '删除 wall' })).toBeTruthy()
  })

  it('给了 onJump 才有「回原文」，标签带词', () => {
    setup()
    expect(screen.getByRole('button', { name: '回到 run 的原文' })).toBeTruthy()
  })

  it('没有 onJump 时不出「回原文」', () => {
    setup({ onJump: undefined })
    expect(screen.queryByRole('button', { name: /的原文/ })).toBeNull()
  })

  it('两步删除：确认态换成「确认删除 X」', () => {
    setup({ confirmDel: 'w1' })
    const confirm = screen.getByRole('button', { name: '确认删除 run' })
    expect(confirm.textContent).toBe('确认删除')
    fireEvent.click(confirm)
  })

  it('按钮仍调对回调（标签不改变行为）', () => {
    const { onReview, onDelete } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'wall：记得' }))
    expect(onReview).toHaveBeenCalledWith('w2', 'good')
    fireEvent.click(screen.getByRole('button', { name: '删除 run' }))
    expect(onDelete).toHaveBeenCalledWith('w1')
  })
})

describe('VocabList：表格视图的图标按钮带上词条', () => {
  it('编辑/删除都念得出 lemma', () => {
    setup({ view: 'table' })
    expect(screen.getByRole('button', { name: '编辑词条 run' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '删除词条 wall' })).toBeTruthy()
  })

  it('确认态换成「确认删除 lemma」', () => {
    setup({ view: 'table', confirmDel: 'w2' })
    expect(screen.getByRole('button', { name: '确认删除 wall' }).textContent).toBe('确认')
  })
})
