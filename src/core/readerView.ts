export interface ReaderViewFlagsInput {
  studyOpen: boolean
  quizSetupOpen: boolean
  quizQueue: boolean
  quizWarmup: boolean
  quickQueue: boolean
  dictQueue: boolean
  listenOpen: boolean
  backOpen: boolean
  goldenOpen: boolean
  speedReadOpen: boolean
  writingOpen: boolean
  browseAll: boolean
  browseArticle: boolean
}

export interface ReaderViewFlags {
  /** 考试 / 快刷 / 听写 / 听力 / 金句 / 速读：隐藏正文 */
  examActive: boolean
  /** 纯阅读视图：否则隐藏精读工具栏 */
  readingView: boolean
}

/** 阅读页「现在是不是在看正文」的唯一判定；视图只读结果，不自己拼一长串布尔。 */
export function readerViewFlags(input: ReaderViewFlagsInput): ReaderViewFlags {
  const examActive =
    input.quizSetupOpen ||
    input.quizQueue ||
    input.quizWarmup ||
    input.quickQueue ||
    input.dictQueue ||
    input.listenOpen ||
    input.backOpen ||
    input.goldenOpen ||
    input.speedReadOpen
  const readingView =
    !input.studyOpen && !examActive && !input.writingOpen && !input.browseAll && !input.browseArticle
  return { examActive, readingView }
}
