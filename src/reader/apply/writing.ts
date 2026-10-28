import {
  addWritingRecord,
  parseImitationTask,
  parseWritingFeedback,
} from '../../core/writing'
import type { ApplyContext, ApplyOutcome } from './types'

/** 仿写：生成任务（只改界面状态，不写历史）。 */
export function applyImitationTask(ctx: ApplyContext): ApplyOutcome {
  const task = parseImitationTask(ctx.text)
  if (!task)
    return { report: ['没解析出仿写任务（需要 JSON：{task, model, rubric}）'], missing: null, ok: false }
  ctx.setWritingTask(task)
  ctx.setWritingFeedback(null)
  return { report: [`已生成仿写任务（${task.rubric.length} 个维度）`], missing: null, ok: true }
}

/** 仿写：批改结果写历史。 */
export function applyWritingFeedback(ctx: ApplyContext): ApplyOutcome {
  const feedback = parseWritingFeedback(ctx.text)
  if (!feedback)
    return { report: ['没解析出批改结果（需要 JSON：{scores, issues, polished}）'], missing: null, ok: false }
  ctx.setWritingFeedback(feedback)
  ctx.setWritingHistory((history) =>
    addWritingRecord(history, {
      at: new Date().toISOString(),
      articleId: ctx.articleIdentity,
      articleTitle: ctx.articleTitle || undefined,
      model: ctx.writingModel,
      text: ctx.writingText,
      feedback,
      task: ctx.writingTask ?? undefined,
    }),
  )
  ctx.recordActivity('write', 1)
  return { report: [`批改完成：${feedback.total}/${feedback.max}，${feedback.issues.length} 处修改`], missing: null, ok: true }
}
