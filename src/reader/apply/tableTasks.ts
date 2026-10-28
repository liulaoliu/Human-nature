import { applyTableTask, type ApplyTableTask } from '../../core/aiApply'
import type { AiTaskKey } from '../hooks/aiTasks'
import type { ApplyContext, ApplyOutcome } from './types'

/**
 * 「解析表格 → 写库」那类任务：规则全在 `core/aiApply`（那边有逐条测试），
 * 这里只做分派 + 落库，不再各写一份 report。
 */
const TABLE_TASKS: Partial<Record<AiTaskKey, ApplyTableTask>> = {
  confusable: 'confusable',
  example: 'example',
  phrase: 'phrase',
  grammar_mark: 'grammar_mark',
  lemma: 'lemma',
  pos: 'pos',
}

/** 表格型任务命中就执行；其他任务返回 null，交给专用处理器 / 通用解析。 */
export function applyTableTaskIfAny(ctx: ApplyContext): ApplyOutcome | null {
  const tableTask = ctx.task ? TABLE_TASKS[ctx.task] : undefined
  if (!tableTask) return null
  const out = applyTableTask(tableTask, ctx.text, ctx.currentLibrary, ctx.askedWords)
  if (out.next) ctx.commit(out.next)
  return { report: out.report, missing: out.missing, ok: out.ok }
}
