import { describe, expect, it } from 'vitest'
import { readerViewFlags, type ReaderViewFlagsInput } from './readerView'

const base: ReaderViewFlagsInput = {
  studyOpen: false,
  quizSetupOpen: false,
  quizQueue: false,
  quizWarmup: false,
  quickQueue: false,
  dictQueue: false,
  listenOpen: false,
  backOpen: false,
  goldenOpen: false,
  speedReadOpen: false,
  writingOpen: false,
  browseAll: false,
  browseArticle: false,
}

describe('reader view flags', () => {
  it('没有任何会话时是纯阅读', () => {
    expect(readerViewFlags(base)).toEqual({ examActive: false, readingView: true })
  })

  it('任一整页会话都算 examActive，并关掉阅读工具栏', () => {
    expect(readerViewFlags({ ...base, goldenOpen: true })).toEqual({ examActive: true, readingView: false })
    expect(readerViewFlags({ ...base, speedReadOpen: true }).readingView).toBe(false)
    expect(readerViewFlags({ ...base, listenOpen: true }).examActive).toBe(true)
  })

  it('背单词 / 仿写 / 生词浏览也关工具栏，但不算 examActive', () => {
    expect(readerViewFlags({ ...base, studyOpen: true })).toEqual({ examActive: false, readingView: false })
    expect(readerViewFlags({ ...base, writingOpen: true })).toEqual({ examActive: false, readingView: false })
    expect(readerViewFlags({ ...base, browseAll: true })).toEqual({ examActive: false, readingView: false })
    expect(readerViewFlags({ ...base, browseArticle: true })).toEqual({ examActive: false, readingView: false })
  })
})
