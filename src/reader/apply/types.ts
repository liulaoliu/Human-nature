import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { ActivityCat } from '../../core/activity'
import type { EcdictLevel } from '../../core/ecdict'
import type { ListeningQuiz } from '../../core/listening'
import type {
  ImitationTask,
  WritingFeedback,
  WritingRecord,
} from '../../core/writing'
import type { MissingTask } from '../missingPrompts'
import type { Sentence, VocabLibrary, VocabVia } from '../../types/document'
import type { BatchItemLike } from '../batchItem'
import type { AiTaskKey } from '../hooks/useAiTasks'
import type { ReaderDoc } from '../hooks/useReaderDoc'

export interface ApplyOutcome {
  report: string[]
  /** 缺失任务 + 缺的词；类型跟「复制未返回的」提示词共用一份（reader/missingPrompts） */
  missing: { task: MissingTask; words: string[] } | null
  ok: boolean
}

export interface ApplyTaskParams {
  library: VocabLibrary
  /** 词库的可变引用：一次跑批里多个任务挨个应用时用它串起来，避免相互覆盖。 */
  libraryRef: MutableRefObject<VocabLibrary>
  sentence: Sentence | null
  persist: (library: VocabLibrary) => void
  mergeBatch: (items: BatchItemLike[]) => void
  batchItemsFromWords: (words: string[], via?: VocabVia) => BatchItemLike[]
  /** 自动标词直入：true = 直接写进生词本（跳过「待选」）。 */
  autoVocabDirect: boolean
  /** 把词条直接加进生词本（按原形去重）。 */
  commitBatchItems: (items: BatchItemLike[]) => void
  articleTitle: string
  articleKey: string | null
  articleIdentity: string
  /** 当前打开的文档（金句课需要正文与段落）；旧调用方可以不传。 */
  doc?: ReaderDoc | null
  /** 听力题缓存键（`core/docSignature.articleKey`，与 `useListening` 读取时一致）。 */
  listeningKey: string
  writingModel: string
  writingText: string
  writingTask: ImitationTask | null
  recordActivity: (cat: ActivityCat, n?: number) => void
  /** 自动标词的词汇水平（用离线词典按 tag 过滤超纲词）。 */
  ecdictLevel: EcdictLevel
  /** 当前文章正文（AI 给词太少时，用离线词典补几个）。 */
  articleText: string
  /** 某个词在本篇里的那句来源（写回来源/语境用）。 */
  sentenceForWord: (word: string) => { sentence: string; sentenceId: string | null }
  setDoc: Dispatch<SetStateAction<ReaderDoc | null>>
  setPendingSave: (v: boolean) => void
  setListenQuiz: (q: ListeningQuiz | null) => void
  setWritingTask: (t: ImitationTask | null) => void
  setWritingFeedback: (f: WritingFeedback | null) => void
  setWritingHistory: Dispatch<SetStateAction<WritingRecord[]>>
}

export type ApplyTaskFn = (
  task: AiTaskKey | null,
  raw: string,
  askedWords: string[],
  askedIds: string[],
  meta?: { articleKey?: string },
) => ApplyOutcome

/** 一次应用调用共享的上下文：参数 + 已解析文本 + 当前词库 + 落库函数。 */
export interface ApplyContext extends ApplyTaskParams {
  task: AiTaskKey | null
  text: string
  askedWords: string[]
  askedIds: string[]
  meta?: { articleKey?: string }
  /** 本次应用开始时的最新词库（不是渲染时快照）。 */
  currentLibrary: VocabLibrary
  commit: (next: VocabLibrary) => void
}
