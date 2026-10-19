// @vitest-environment jsdom
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ReaderArticle, { type ReaderArticleProps } from './ReaderArticle'
import { sentenceFixture } from '../core/testFixtures'

/** 正文区组件测试：标题回退、改名入口、编辑态/阅读态切换。 */
function setup(over: Partial<ReaderArticleProps> = {}) {
  const props: ReaderArticleProps = {
    doc: { paragraphs: [], sentences: [] },
    articleTitle: '',
    articleKey: '009 Leaders',
    onRename: vi.fn(),
    editing: false,
    draft: '',
    onDraftChange: vi.fn(),
    translateView: 'off',
    selectedId: null,
    peekSid: null,
    vocabSidSet: new Set(),
    selSid: null,
    selIndices: [],
    libraryLemmas: new Set(),
    articleNums: new Map(),
    articleFirst: new Set(),
    showLanguage: false,
    vocabMode: false,
    lastPicked: null,
    bubblePos: null,
    articleRef: createRef<HTMLElement>(),
    onSelectSentence: vi.fn(),
    onFocusEntry: vi.fn(),
    onAltCopyText: vi.fn(),
    karaoke: null,
    onSpeakFromWord: vi.fn(),
    onAddPhrase: vi.fn(),
    ...over,
  }
  const utils = render(<ReaderArticle {...props} />)
  return { ...utils, props }
}

describe('ReaderArticle', () => {
  it('没标题时回退到文章 key，点击 ✎ 调改名', () => {
    const { props } = setup()
    expect(screen.getByRole('heading').textContent).toContain('009 Leaders')
    fireEvent.click(screen.getByTitle('修改文章标题'))
    expect(props.onRename).toHaveBeenCalledTimes(1)
  })

  it('有标题时优先显示标题', () => {
    setup({ articleTitle: 'The green boom' })
    expect(screen.getByRole('heading').textContent).toContain('The green boom')
  })

  it('编辑态显示 textarea 并回传改动', () => {
    const { props } = setup({ editing: true, draft: '旧正文' })
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe('旧正文')
    expect(screen.getByText(/编辑正文/)).toBeTruthy()
    fireEvent.change(textarea, { target: { value: '新正文' } })
    expect(props.onDraftChange).toHaveBeenCalledWith('新正文')
  })

  it('阅读态显示操作提示与正文容器', () => {
    const { container } = setup()
    expect(screen.getByText(/点句子=整句/)).toBeTruthy()
    expect(container.querySelector('article.article')).toBeTruthy()
  })

  it('句子可键盘选中；选词气泡对读屏可见', () => {
    const sentence = sentenceFixture('s1', 'They abandon it.')
    const { props } = setup({
      doc: { paragraphs: [{ id: 'p1', sentenceIds: ['s1'] }], sentences: [sentence] },
      vocabMode: true,
      lastPicked: { word: 'abandon', sid: 's1' },
      bubblePos: { top: 1, left: 2 },
    })
    const sent = screen.getByRole('button', { name: 'They abandon it.' })
    fireEvent.keyDown(sent, { key: 'Enter' })
    expect(props.onSelectSentence).toHaveBeenCalledWith('s1')
    expect(screen.getByRole('status').textContent).toBe('abandon')
  })
})
