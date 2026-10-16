// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ExportPanel from './ExportPanel'
import { vocabItem } from '../../core/testFixtures'

/**
 * 打印/导出面板 = 收选择 + 渲染；口径计算在 core/printPlan（已单测）。
 * 这里测**接线**：点了「内容 / 范围 / 分组」，交给「打印」的条目和标题对不对。
 */
const item = (over: Parameters<typeof vocabItem>[0]) => vocabItem(over)
const lib = [
  item({ id: '1', word: 'run', lemma: 'run', createdAt: '2026-10-01T10:00:00+08:00' }),
  item({ id: '2', word: 'fall back on', lemma: 'fall back on', kind: 'phrase', meaning: '转而依靠', createdAt: '2026-10-02T10:00:00+08:00' }),
  item({ id: '3', word: '注意 run 的用法', lemma: '注意 run 的用法', kind: 'usage', createdAt: '2026-10-03T10:00:00+08:00' }),
]

function setup(over: Partial<Parameters<typeof ExportPanel>[0]> = {}) {
  const onPrint = vi.fn()
  const onExportAnki = vi.fn()
  const onExportWordList = vi.fn()
  render(
    <ExportPanel
      onClose={vi.fn()}
      libraryItems={lib}
      articleTitle="A 篇"
      articleWords={lib}
      articles={[{ id: 'A', title: 'A 篇', lemmas: new Set<string>() }]}
      todayKey="2026-10-02"
      onPrint={onPrint}
      onExportAnki={onExportAnki}
      onExportWordList={onExportWordList}
      {...over}
    />,
  )
  return { onPrint, onExportAnki, onExportWordList }
}

const pick = (label: string) => fireEvent.click(screen.getByLabelText(label))

describe('ExportPanel：内容口径', () => {
  it('默认全部；切「词组 / 习语」后只把词组交给打印', () => {
    const { onPrint } = setup()
    expect(screen.getByText('将处理 3 条')).toBeTruthy()
    pick('词组 / 习语')
    expect(screen.getByText('将处理 1 条')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /A4 打印/ }))
    const [items, title] = onPrint.mock.calls[0]
    expect(items.map((it: { word: string }) => it.word)).toEqual(['fall back on'])
    expect(title).toBe('A 篇·词组习语表')
  })

  it('用法笔记：内容选「用法笔记」时 TXT 按钮禁用（导不出单词表）', () => {
    setup()
    pick('用法笔记')
    expect(screen.getByText('将处理 1 条')).toBeTruthy()
    const txt = screen.getByRole('button', { name: /单词表 TXT/ }) as HTMLButtonElement
    expect(txt.disabled).toBe(true)
  })
})

describe('ExportPanel：范围与动作', () => {
  it('按日期：清空后只选一天，就把那天的条目交出去', () => {
    const { onPrint } = setup()
    pick('按日期（可多选）')
    fireEvent.click(screen.getByRole('button', { name: '清空' }))
    fireEvent.click(screen.getByLabelText(/2026-10-01/))
    fireEvent.click(screen.getByRole('button', { name: /A4 打印/ }))
    const [items, title] = onPrint.mock.calls[0]
    expect(items.map((it: { word: string }) => it.word)).toEqual(['run'])
    expect(title).toBe('词表-新增-2026-10-01')
  })

  it('按日期：多选几天时同一条只算一次（默认今天已勾上）', () => {
    const { onPrint } = setup()
    pick('按日期（可多选）')
    fireEvent.click(screen.getByLabelText(/2026-10-01/)) // 加上 10-01（10-02 默认已勾）
    fireEvent.click(screen.getByRole('button', { name: /A4 打印/ }))
    const [items, title] = onPrint.mock.calls[0]
    expect(items.map((it: { word: string }) => it.word)).toEqual(['run', 'fall back on'])
    expect(title).toBe('词表-新增-2天')
  })

  it('未打印：全都没打过 → 全部条目', () => {
    const { onExportAnki } = setup()
    // 单选按钮的 label 是「未打印（3）」，用正则匹配标签文本
    fireEvent.click(screen.getByLabelText(/未打印/))
    fireEvent.click(screen.getByRole('button', { name: /Anki CSV/ }))
    expect(onExportAnki.mock.calls[0][0]).toHaveLength(3)
  })

  it('Anki / TXT 都带上当前标题当文件名', () => {
    const { onExportWordList } = setup()
    fireEvent.click(screen.getByRole('button', { name: /单词表 TXT/ }))
    expect(onExportWordList.mock.calls[0][1]).toBe('A 篇')
  })
})
