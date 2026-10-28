import { useCallback } from 'react'
import type { MutableRefObject } from 'react'
import type { AiTaskKey } from './aiTasks'
import type { ApplyOutcome } from './useApplyTaskResult'

type PasteMissing = ApplyOutcome['missing']

export interface UsePasteApplyParams {
  /** 粘贴框里的原始文本 */
  pasted: string
  /** 应用成功后清空粘贴框 */
  clearPasted: () => void
  /** 当前选中的任务（没先点按钮时为 translate） */
  lastTask: AiTaskKey | null
  applyTaskResult: (
    task: AiTaskKey | null,
    raw: string,
    askedWords: string[],
    askedIds: string[],
    meta?: { articleKey?: string },
  ) => ApplyOutcome
  askedWordsRef: MutableRefObject<string[]>
  askedIdsRef: MutableRefObject<string[]>
  /** 上次请求所属文章（金句课粘回时校验）。 */
  askedArticleKeyRef?: MutableRefObject<string | null>
  /** 回执（成功 / 缺失 / 无效）写回面板 */
  onReport: (report: string[]) => void
  /** 缺失词写回面板，供「一键复制未返回的」重试 */
  onMissing: (missing: PasteMissing) => void
  /** 网页版工作包（@@@ANSWER / JSON results）解析；认得出返回 true */
  applyAiWeb: (text: string) => boolean
  flash: (message: string) => void
}

export interface UsePasteApplyResult {
  /** 按当前任务应用粘贴结果 */
  applyPaste: () => void
  /** 统一入口：先认工作包，否则退回单任务 */
  applyAnyPaste: () => void
}

/**
 * 「应用结果」粘贴框的两个动作。
 *
 * 状态（pasted / report / missing）仍留在 `ReaderApp`：`useAiPack` 也要写回执，
 * 放到这里会和它的初始化顺序打架。这里只收口「点什么、按哪个任务解析」。
 */
export function usePasteApply({
  pasted,
  clearPasted,
  lastTask,
  applyTaskResult,
  askedWordsRef,
  askedIdsRef,
  askedArticleKeyRef,
  onReport,
  onMissing,
  applyAiWeb,
  flash,
}: UsePasteApplyParams): UsePasteApplyResult {
  const applyPaste = useCallback(() => {
    const raw = pasted.trim()
    if (!raw) return
    // 语言点 JSON 若没先点过「语言点」按钮（lastTask≠language），会被当成翻译空转。
    // 这里自动识别：含 structure/grammar/idioms/phrases/usage 且没有 translation → 按语言点应用。
    const looksLikeLang = /"(structure|grammar|idioms|phrases|usage)"\s*:/.test(raw) && !/"translation"\s*:/.test(raw)
    const task = lastTask === 'language' || looksLikeLang ? 'language' : lastTask
    const key = askedArticleKeyRef?.current
    const res = key
      ? applyTaskResult(task, raw, askedWordsRef.current, askedIdsRef.current, { articleKey: key })
      : applyTaskResult(task, raw, askedWordsRef.current, askedIdsRef.current)
    onReport(res.report)
    onMissing(res.missing)
    if (res.ok) {
      clearPasted()
      flash(res.report[0] ?? '已应用')
    } else {
      flash(res.report[0] ?? '没解析出内容')
    }
  }, [pasted, clearPasted, lastTask, applyTaskResult, askedWordsRef, askedIdsRef, askedArticleKeyRef, onReport, onMissing, flash])

  const applyAnyPaste = useCallback(() => {
    const text = pasted.trim()
    if (!text) return
    const isPack = text.includes('@@@ANSWER') || /"results"\s*:/.test(text)
    if (isPack) {
      if (applyAiWeb(text)) clearPasted()
      return
    }
    applyPaste()
  }, [pasted, clearPasted, applyAiWeb, applyPaste])

  return { applyPaste, applyAnyPaste }
}
