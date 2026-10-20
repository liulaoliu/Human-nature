// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { VocabCardBlock } from '../../core/vocab'
import VocabBlocks from './VocabBlocks'

const blocks: VocabCardBlock[] = [
  { key: 'usage', label: '用法', lines: ['run a business', 'run late'] },
  { key: 'phrases', label: '词组', lines: ['run into'] },
]

describe('VocabBlocks', () => {
  it('空数组不渲染', () => {
    const { container } = render(<VocabBlocks blocks={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('按 core 给的顺序与文案排版，多行逐行显示', () => {
    const { container } = render(<VocabBlocks blocks={blocks} />)
    expect(screen.getByText('用法')).toBeTruthy()
    expect(screen.getByText('run a business')).toBeTruthy()
    expect(screen.getByText('run late')).toBeTruthy()
    expect(screen.getByText('词组')).toBeTruthy()
    expect(container.querySelectorAll('.vblock')).toHaveLength(2)
    expect(container.querySelectorAll('.vblock-line')).toHaveLength(3)
    expect(container.querySelector('.vblock-usage')).toBeTruthy()
  })

  it('className 透传（卡片与生词本共用样式）', () => {
    const { container } = render(<VocabBlocks blocks={blocks} className="in-study" />)
    expect((container.firstChild as HTMLElement).className).toBe('vblocks in-study')
  })
})
