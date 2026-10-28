import type { RefObject } from 'react'
import type { ArticleRepoPort, SavedArticle } from '../../core/ports'
import type { VocabLibrary } from '../../types/document'
import type { WritingRecord } from '../../core/writing'
import type { LearningCollections, LearningSetters } from './useLearningData'

/** 导出 / 打印 / 备份导入共用的一份输入。 */
export interface ExportParams {
  articles: RefObject<ArticleRepoPort | null>
  library: VocabLibrary
  saved: SavedArticle[]
  /** 学习记录快照（useLearningData.data） */
  learning: LearningCollections
  /** 合并导入用的写动作（useLearningData.setters） */
  setters: LearningSetters
  writingHistory: WritingRecord[]
  visibleBatch: { word: string; sentence: string }[]
  persist: (library: VocabLibrary) => void
  /** 立刻写入并等结果（导入备份用；失败会抛给调用方） */
  persistNow: (library: VocabLibrary) => Promise<void>
  flash: (message: string) => void
  setSaved: (list: SavedArticle[]) => void
  setWritingHistory: (v: WritingRecord[]) => void
}
