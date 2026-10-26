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

describe('VocabList：来源标签', () => {
  it('有 via 时显示细分来源，旧批量不冒充手动', () => {
    const badgeItems = [
      vocabItem({ id: 'ai', word: 'run', lemma: 'run', meaning: '跑' }),
      vocabItem({ id: 'dict', word: 'wall', lemma: 'wall', meaning: '墙' }),
      vocabItem({ id: 'manual', word: 'walk', lemma: 'walk', meaning: '走' }),
      vocabItem({ id: 'legacy', word: 'talk', lemma: 'talk', meaning: '说' }),
    ]
    setup({
      items: badgeItems,
      originOf: (it) => (it.id === 'manual' ? 'manual' : 'auto'),
      viaOf: (it) =>
        it.id === 'ai' ? 'ai' : it.id === 'dict' ? 'dict' : it.id === 'manual' ? 'manual' : 'legacy',
    })
    expect(screen.getByText('AI')).toBeTruthy()
    expect(screen.getByText('词典')).toBeTruthy()
    expect(screen.getByText('手动')).toBeTruthy()
    expect(screen.getByText('旧数据')).toBeTruthy()
  })

  it('没有 via 时：自动照旧，手动老条目不再冒充「手动」', () => {
    setup({ originOf: (it) => (it.id === 'w1' ? 'auto' : 'manual') })
    expect(screen.getByText('自动')).toBeTruthy()
    expect(screen.getByText('旧数据')).toBeTruthy()
  })
})

describe('VocabList：字段来源', () => {
  it('音标 / 词性 / 释义的 title 标出来源；旧数据不标', () => {
    setup({
      items: [
        vocabItem({
          word: 'run',
          lemma: 'run',
          phonetic: '/rʌn/',
          partOfSpeech: 'v.',
          meaning: '跑',
          fieldSources: { phonetic: 'ai', partOfSpeech: 'dict', meaning: 'manual' },
        }),
      ],
    })
    expect(screen.getByText('/rʌn/').getAttribute('title')).toBe('音标来源：AI')
    expect(screen.getByText('v.').getAttribute('title')).toBe('词性来源：词典')
    expect(screen.getByText('跑').getAttribute('title')).toBe('释义来源：手动')
  })

  it('本篇语境释义来源优先于词条字段来源', () => {
    setup({
      items: [vocabItem({ word: 'bank', lemma: 'bank', meaning: '河岸', fieldSources: { meaning: 'ai' } })],
      meaningSourceOf: () => 'manual',
    })
    expect(screen.getByText('河岸').getAttribute('title')).toBe('本篇释义来源：手动')
    expect(screen.getByText('手动')).toBeTruthy()
  })
})

describe('VocabList：易混项来源', () => {
  it('表格里标注 AI / 词典；旧数据没有来源就不标', () => {
    setup({
      view: 'table',
      items: [
        vocabItem({ id: 'ai', word: 'adapt', lemma: 'adapt', confusables: [{ word: 'adopt' }], confusablesSource: 'ai' }),
        vocabItem({
          id: 'dict',
          word: 'adept',
          lemma: 'adept',
          confusables: [{ word: 'adopt' }],
          confusablesSource: 'dict',
        }),
        vocabItem({ id: 'legacy', word: 'adopt', lemma: 'adopt', confusables: [{ word: 'adept' }] }),
      ],
    })
    expect(screen.getByText(/易混：\[AI\] adopt/)).toBeTruthy()
    expect(screen.getByText(/易混：\[词典\] adopt/)).toBeTruthy()
    expect(screen.getByText(/易混：adept/)).toBeTruthy()
  })
})

describe('VocabList：全部生词分页', () => {
  const many = Array.from({ length: 5 }, (_, i) =>
    vocabItem({ id: `p${i}`, word: `w${i}`, lemma: `w${i}`, meaning: '义' }),
  )

  it('pageSize：先渲染一页，点「再显示」后继续追加', () => {
    setup({ items: many, pageSize: 2 })
    expect(screen.getByRole('button', { name: '删除 w0' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '删除 w1' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '删除 w2' })).toBeNull()
    expect(screen.getByText('已显示 2 / 5')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /再显示 2 条/ }))
    expect(screen.getByRole('button', { name: '删除 w2' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '删除 w4' })).toBeNull()
  })

  it('定位到某条时至少渲染到它，不把高亮词藏到第二页', () => {
    setup({ items: many, pageSize: 2, focusLemma: 'w4' })
    expect(screen.getByRole('button', { name: '删除 w4' })).toBeTruthy()
    expect(screen.queryByText(/已显示/)).toBeNull()
  })

  it('表格视图也分页', () => {
    setup({ items: many, pageSize: 2, view: 'table' })
    expect(screen.getByRole('button', { name: '删除词条 w1' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '删除词条 w2' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /再显示 2 条/ }))
    expect(screen.getByRole('button', { name: '删除词条 w2' })).toBeTruthy()
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
