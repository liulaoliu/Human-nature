// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { Paragraph } from '../../types/document'
import { sentenceFixture } from '../../core/testFixtures'
import ReaderBody, { type ReaderBodyProps } from './ReaderBody'

/**
 * 回归：`<p>` 里不许出现块级标签。
 *
 * 真实事故（2026-10-23）：每句话的语言点由 `LanguageLines` / `LangPhrases` 渲染，
 * 里面当时用的是 `<div className="lang-line">`、`<div className="lang-phrases">`，
 * 而它们挂在正文段落的 `<p className="para">` 下面。React 18 于是刷了：
 *
 *   Warning: validateDOMNesting(...): <div> cannot appear as a descendant of <p>.
 *
 * **为什么不直接断言 React 的警告**：`validateDOMNesting` 只在 dev 构建里有，
 * 而且按 (childTag, ancestorTag) 全局去重——同一文件里前面任何一个用例触发过，
 * 后面的断言就永远是绿的（假绿）。这里改成直接量 DOM 结构：确定性、与构建模式无关。
 *
 * 结构性的同类检查还有门禁 R8（`tool/check_architecture.mjs`），它跨组件静态扫，
 * 能拦住「新增组件又往 <p> 里塞 div」；这条测试负责验证真实渲染结果。
 */

/** 放进 <p> 里就非法的块级标签（HTML 的 flow content）。 */
const BLOCK_TAGS =
  'div,p,ul,ol,li,dl,dt,dd,table,thead,tbody,tfoot,tr,td,th,caption,section,article,aside,' +
  'nav,header,footer,main,figure,figcaption,form,fieldset,blockquote,pre,hr,address,details,summary,h1,h2,h3,h4,h5,h6'

/** 列出所有「嵌在 <p> 里的块级元素」，空数组 = 合法。 */
function blocksInsideParagraphs(root: HTMLElement): string[] {
  return [...root.querySelectorAll('p')].flatMap((p) =>
    [...p.querySelectorAll(BLOCK_TAGS)].map(
      (el) => `<${el.tagName.toLowerCase()} class="${el.className}">`,
    ),
  )
}

const paragraphs: Paragraph[] = [{ id: 'p1', sentenceIds: ['s1'] }]

const withLanguage = sentenceFixture('s1', 'Run fast.', {
  translation: '跑快点。',
  languages: [
    {
      structure: 'SV',
      grammar: '一般现在时',
      idioms: ['run fast — 跑得快'],
      phrases: ['run into — 撞上', 'run out — 用完'],
      usage: ['run a business'],
      source: 'manual',
    },
  ],
})

function props(over: Partial<ReaderBodyProps> = {}): ReaderBodyProps {
  const noop = vi.fn()
  return {
    paragraphs,
    sentences: [withLanguage],
    translateView: 'below',
    selectedId: null,
    peekSid: null,
    vocabSidSet: new Set(),
    selSid: null,
    selIndices: [],
    libraryLemmas: new Set(),
    articleNums: new Map(),
    articleFirst: new Set(),
    showLanguage: true,
    vocabMode: false,
    lastPicked: null,
    bubblePos: null,
    articleRef: { current: null },
    onSelectSentence: noop,
    onFocusEntry: noop,
    onAltCopyText: noop,
    karaoke: null,
    onWordSeek: noop,
    onAddPhrase: noop,
    ...over,
  }
}

describe('DOM 嵌套：段落里不放块级元素', () => {
  it('语言点全开（结构/语法/习语/词组/用法 + 手动标记）时，<p> 里只有 inline 元素', () => {
    const { container } = render(<ReaderBody {...props()} />)
    // 先确认语言点真的渲染出来了，避免「没渲染所以没嵌套」的假绿
    expect(container.querySelectorAll('.lang-block')).toHaveLength(1)
    expect(container.querySelectorAll('.lang-line').length).toBeGreaterThanOrEqual(3)
    expect(container.querySelectorAll('.lang-phrases').length).toBe(2)

    expect(blocksInsideParagraphs(container)).toEqual([])
  })

  it('逐句译文 + 只看译文两种模式同样不嵌套', () => {
    const { container, rerender } = render(<ReaderBody {...props()} />)
    expect(blocksInsideParagraphs(container)).toEqual([])

    rerender(<ReaderBody {...props({ translateView: 'only' })} />)
    expect(blocksInsideParagraphs(container)).toEqual([])
  })

  it('没有语言点 / 没有译文时也守着同样的约束', () => {
    const plain = sentenceFixture('s1', 'Run fast.')
    const { container } = render(
      <ReaderBody {...props({ sentences: [plain], showLanguage: false, translateView: 'off' })} />,
    )
    expect(blocksInsideParagraphs(container)).toEqual([])
  })
})
