import type { VocabLibrary } from '../../types/document'
import type { AiTaskKey } from '../hooks/aiTasks'
import { applyAnalysisResult } from './analysis'
import { applyAutoVocab } from './autoVocab'
import { applyGoldenLesson } from './goldenLesson'
import { applyLanguageTask } from './language'
import { applyListening } from './listening'
import { applyTableTaskIfAny } from './tableTasks'
import type { ApplyContext, ApplyOutcome, ApplyTaskFn, ApplyTaskParams } from './types'
import { applyImitationTask, applyWritingFeedback } from './writing'

/** 一种任务 = 一个处理器；新增 AI 任务只在这里加一条，不改 if 链。 */
const HANDLERS: Partial<Record<AiTaskKey, (ctx: ApplyContext) => ApplyOutcome>> = {
  auto_vocab: applyAutoVocab,
  golden: applyGoldenLesson,
  listening: applyListening,
  language: applyLanguageTask,
  imitation: applyImitationTask,
  feedback: applyWritingFeedback,
}

/**
 * 复制提示词时记下所属文章；应用时如果已经切篇，必须拒绝。
 *
 * 译文 / 语言点结果只带 `s001` 这样的**篇内 id**，不带正文；旧逻辑只按 id 写回，
 * 于是「在 A 篇复制提示词、切到 B 篇贴结果」会把 A 的译文/语言点写进 B 的同号句子
 * （Passé 的 s001/s002 就这么被 Myanmar 篇覆盖过）。所有任务统一在这里挡。
 */
function rejectIfArticleChanged(ctx: ApplyContext): ApplyOutcome | null {
  const askedKey = ctx.meta?.articleKey
  if (askedKey && ctx.articleKey && askedKey !== ctx.articleKey) {
    return {
      report: ['文章已切换，这份结果未应用；切回原文章再贴一次'],
      missing: null,
      ok: false,
    }
  }
  return null
}

/**
 * 应用一份 AI 结果（按任务分派）。单条「应用结果」与整包导入都走这里。
 *
 * 这里没有 React 状态，所以是普通 factory，不是 hook；`useApplyTaskResult` 只负责
 * 用 `useMemo` 保住函数身份。只做解析 + 落库，不动 UI 状态（回执 / 缺失 / 清空交给调用方）。
 */
export function createApplyTaskResult(params: ApplyTaskParams): ApplyTaskFn {
  return (task, raw, askedWords, askedIds, meta) => {
    const text = raw.trim()
    if (!text) return { report: [], missing: null, ok: false }

    // 本次应用基于「当前最新词库」；每写一次就更新 ref，供同一批里的下一条接着用，
    // 避免多条任务各拿同一份旧库互相覆盖（会导致某些词永远补不上、反复待办）。
    const currentLibrary = params.libraryRef.current
    const commit = (next: VocabLibrary) => {
      params.libraryRef.current = next
      params.persist(next)
    }
    const ctx: ApplyContext = { ...params, task, text, askedWords, askedIds, meta, currentLibrary, commit }

    const rejected = rejectIfArticleChanged(ctx)
    if (rejected) return rejected

    // 表格型任务：解析 / 校验 / 回执都在 core/aiApply，这里只落库
    const table = applyTableTaskIfAny(ctx)
    if (table) return table

    const handler = task ? HANDLERS[task] : undefined
    return handler ? handler(ctx) : applyAnalysisResult(ctx)
  }
}
