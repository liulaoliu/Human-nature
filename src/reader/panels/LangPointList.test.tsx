// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import LangPointList from './LangPointList'
import { vocabItem } from '../../core/testFixtures'

/**
 * 语言点列表：词组/习语按类型分组、显示「英文 + 释义 + 来源句」；用法笔记不朗读。
 * 这是「生词和语言点分开显示」里语言点那一半的展示契约。
 */
const items = [
  vocabItem({ id: 'p1', word: 'fall back on', lemma: 'fall back on', kind: 'phrase', meaning: '转而依靠', source: { articleId: 'A', fileName: 'A', sentenceId: 's1', sentenceText: 'He falls back on his savings.' } }),
  vocabItem({ id: 'p2', word: 'run out', lemma: 'run out', kind: 'phrase', meaning: '用完' }),
  vocabItem({ id: 'i1', word: 'take its toll', lemma: 'take its toll', kind: 'idiom', meaning: '造成损害' }),
  vocabItem({ id: 'u1', word: '注意 subject to 是形容词', lemma: '注意 subject to 是形容词', kind: 'usage' }),
]

describe('LangPointList', () => {
  it('按 词组 / 习语 / 用法 分组，各带条数', () => {
    render(<LangPointList items={items} />)
    expect(screen.getByText('词组')).toBeTruthy()
    expect(screen.getByText('习语')).toBeTruthy()
    expect(screen.getByText('用法')).toBeTruthy()
    // 词组那组是 2 条
    expect(screen.getByText('词组').parentElement?.textContent).toContain('2')
  })

  it('词组显示「英文 + 中文释义」和来源句；没有来源句就不显示那行', () => {
    render(<LangPointList items={items} />)
    expect(screen.getByText('fall back on')).toBeTruthy()
    expect(screen.getByText('转而依靠')).toBeTruthy()
    expect(screen.getByText('He falls back on his savings.')).toBeTruthy()
  })

  it('点词组朗读；用法笔记不朗读（中文说明没有发音的意义）', () => {
    const onSpeak = vi.fn()
    render(<LangPointList items={items} onSpeak={onSpeak} />)
    fireEvent.click(screen.getByText('fall back on'))
    expect(onSpeak).toHaveBeenCalledWith('fall back on')
    fireEvent.click(screen.getByText('注意 subject to 是形容词'))
    expect(onSpeak).toHaveBeenCalledTimes(1)
  })

  it('删除要两步确认：第一次点只是「确认」，再点才真删', () => {
    const onDelete = vi.fn()
    const view = render(<LangPointList items={items} onDelete={onDelete} confirmDel={null} />)
    const del = screen.getAllByRole('button', { name: '×' })[0]
    fireEvent.click(del)
    expect(onDelete).toHaveBeenCalledWith('p1')
    view.rerender(<LangPointList items={items} onDelete={onDelete} confirmDel="p1" />)
    expect(screen.getByRole('button', { name: '确认' })).toBeTruthy()
  })

  it('空列表给提示', () => {
    render(<LangPointList items={[]} />)
    expect(screen.getByText(/还没有语言点/)).toBeTruthy()
  })
})
