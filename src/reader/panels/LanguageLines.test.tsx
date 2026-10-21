// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import LanguageLines from './LanguageLines'

describe('LanguageLines：一条语言点的正文（正文 / 速读 / 日志共用）', () => {
  const lang = {
    structure: 'SVO',
    grammar: '一般现在时',
    idioms: ['run fast — 跑得快'],
    phrases: ['at once — 立刻'],
    usage: ['口语常用'],
  }

  it('按 结构 → 语法 → 习语 → 词组 → 用法 的顺序显示', () => {
    const { container } = render(<LanguageLines lang={lang} />)
    const text = container.textContent ?? ''
    expect(text.indexOf('结构：SVO')).toBeLessThan(text.indexOf('语法：一般现在时'))
    expect(text.indexOf('语法：一般现在时')).toBeLessThan(text.indexOf('习语：'))
    expect(text.indexOf('习语：')).toBeLessThan(text.indexOf('词组：'))
    expect(text.indexOf('词组：')).toBeLessThan(text.indexOf('用法：口语常用'))
  })

  it('词组 / 习语可点一下加入生词本', () => {
    const onAddPhrases = vi.fn()
    render(<LanguageLines lang={lang} onAddPhrases={onAddPhrases} />)
    fireEvent.click(screen.getByRole('button', { name: /run fast/ }))
    expect(onAddPhrases).toHaveBeenCalledWith(['run fast — 跑得快'])
  })

  it('plain：只读纯文本，不渲染按钮', () => {
    const { container } = render(<LanguageLines lang={lang} plain />)
    expect(container.querySelectorAll('button')).toHaveLength(0)
    expect(screen.getByText('习语：run fast — 跑得快')).toBeTruthy()
    expect(screen.getByText('词组：at once — 立刻')).toBeTruthy()
  })

  it('空字段不占行', () => {
    const { container } = render(<LanguageLines lang={{ grammar: '时态' }} />)
    expect(container.textContent).toBe('语法：时态')
  })

  it('结构 / 语法里的换行原样保留（.lang-line 用 pre-wrap 显示）', () => {
    const { container } = render(<LanguageLines lang={{ structure: '第一段\n第二段\n\n第三段' }} />)
    const line = container.querySelector('.lang-line')
    expect(line?.textContent).toBe('结构：第一段\n第二段\n\n第三段')
  })
})
