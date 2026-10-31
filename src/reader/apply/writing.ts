import {
  addWritingRecord,
  parseImitationTask,
  parseWritingFeedbackDetailed,
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
  const parsed = parseWritingFeedbackDetailed(ctx.text, { answer: ctx.writingText })
  const feedback = parsed?.feedback
  if (!feedback)
    return {
      report: ['没解析出批改结果（需要 JSON：{version, scores, issues, recommendations, polished}）'],
      missing: null,
      ok: false,
    }
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
  const report = [
    `批改完成：${feedback.total}/${feedback.max}，${feedback.issues.length} 处修改`,
  ]
  const dropped = parsed.dropped
  if (dropped.issues || dropped.recommendations) {
    report.push(`已忽略 ${dropped.issues} 条无法定位的问题、${dropped.recommendations} 条无效语言点`)
  }
  if (dropped.inferred) report.push(`${dropped.inferred} 条缺 rule/key，已自动归类`)
  return { report, missing: null, ok: true }
}
