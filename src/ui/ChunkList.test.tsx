// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ChunkList } from './ChunkList'

const chunks = [
  { index: 0, start: 0, end: 5 },
  { index: 1, start: 5, end: 9 },
]

describe('ChunkList', () => {
  beforeEach(() => {
    // jsdom 没有实现滚动；组件会自动把当前块滚进视口
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('渲染每块的序号与起点，当前块高亮', () => {
    const { container } = render(
      <ChunkList
        chunks={chunks}
        current={1}
        takeCountByChunk={new Map()}
        splitTimes={new Set()}
        onSelect={() => {}}
      />,
    )
    const rows = container.querySelectorAll('.row')
    expect(rows).toHaveLength(2)
    expect(rows[0].className).toBe('row')
    expect(rows[1].className).toBe('row on')
    expect(rows[0].textContent).toContain('0:00')
    expect(rows[1].textContent).toContain('0:05')
  })

  it('显示录音条数与手动撕开标记', () => {
    render(
      <ChunkList
        chunks={chunks}
        current={0}
        takeCountByChunk={new Map([[1, 2]])}
        splitTimes={new Set([Math.round(5 * 50)])}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByTitle('2 条录音').textContent).toBe('●2')
    expect(screen.getByTitle('手动撕开的新边界')).toBeTruthy()
  })

  it('点一行把块号回传', () => {
    const onSelect = vi.fn()
    const { container } = render(
      <ChunkList
        chunks={chunks}
        current={0}
        takeCountByChunk={new Map()}
        splitTimes={new Set()}
        onSelect={onSelect}
      />,
    )
    fireEvent.click(container.querySelectorAll('.row')[1])
    expect(onSelect).toHaveBeenCalledWith(1)
  })
})
