import { useRef } from 'react'
import type { ActivityCat } from '../../core/activity'
import type { BackTranslationRecord } from '../../core/backTranslate'
import type { ReaderDoc } from './useReaderDoc'
import type { runAiBatch } from '../../adapters/aiRun'
import { useBackTranslateGrading } from './useBackTranslateGrading'
import { useBackTranslateSession } from './useBackTranslateSession'

export interface UseBackTranslateParams {
  doc: ReaderDoc | null
  selectedId: string | null
  articleIdentity: string
  articleTitle: string
  /** 已存档的全部回译记录（useLearningData） */
  history: BackTranslationRecord[]
  /** 追加一条存档（useLearningData.saveBackTranslation） */
  saveRecord: (rec: BackTranslationRecord) => void
  recordActivity: (cat: ActivityCat, n?: number) => void
  flash: (message: string) => void
  /** 打开回译时关掉其它整页会话。 */
  closeOthers: () => void
  /** 测试注入：AI 是否已配置 */
  aiStatus?: () => Promise<boolean>
  /** 测试注入：跑一条批改任务 */
  runAi?: typeof runAiBatch
  now?: () => Date
}

/**
 * 回译训练会话：中文题干 → 用户写英文 → AI 批改 → 存档。
 *
 * 批改有两条路：本机配了 AI key 就直连 `/api/ai/run`；没有就复制提示词，
 * 让用户把 AI 的 JSON 粘回面板。两条路共用同一个严格解析器。
 * 存档只追加、不截断（长期学习资产），写入交给 useLearningData。
 *
 * 出题 / 导航在 `useBackTranslateSession`，批改在 `useBackTranslateGrading`；
 * 两者共用同一个 AbortController，关会话 / 卸载时一起取消。
 */
export function useBackTranslate(params: UseBackTranslateParams) {
  const abortRef = useRef<AbortController | null>(null)
  const session = useBackTranslateSession({
    doc: params.doc,
    selectedId: params.selectedId,
    articleIdentity: params.articleIdentity,
    articleTitle: params.articleTitle,
    history: params.history,
    closeOthers: params.closeOthers,
    flash: params.flash,
    abortRef,
  })
  const grading = useBackTranslateGrading({
    session,
    saveRecord: params.saveRecord,
    recordActivity: params.recordActivity,
    flash: params.flash,
    abortRef,
    aiStatus: params.aiStatus,
    runAi: params.runAi,
    now: params.now,
  })
  return { ...session, ...grading }
}
