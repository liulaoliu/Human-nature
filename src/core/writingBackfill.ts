/**
 * 旧批改 → v2 的**纯映射**（回填脚本与测试共用）。
 *
 * 这里不碰数据库、不碰文件系统；`tools/backfill-writing-v2.mjs` 只负责读写 SQLite。
 */
import {
  classifyLegacyIssue,
  isWritingIssueKey,
  isWritingRule,
  writingKeyFor,
  writingTypeOf,
} from './writingErrorRules.ts'
import type { WritingFeedback, WritingIssue } from './writing.ts'

/** 把一条旧 issue 升级成 v2；已经带合法 rule/key 的保留。 */
export function upgradeWritingIssue(raw: unknown): { issue: WritingIssue; inferred: boolean } {
  const issue = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const original = typeof issue.original === 'string' ? issue.original : ''
  const suggestion = typeof issue.suggestion === 'string' ? issue.suggestion : ''
  const reason = typeof issue.reason === 'string' ? issue.reason : ''
  const fallback = classifyLegacyIssue({ original, suggestion, reason })
  const rule = isWritingRule(issue.rule) ? issue.rule : fallback.rule
  const key = isWritingIssueKey(issue.key) ? issue.key : writingKeyFor(rule, original, suggestion)
  const severity =
    issue.severity === 'improvement' || issue.severity === 'must-fix'
      ? issue.severity
      : fallback.severity
  return {
    issue: {
      original,
      suggestion,
      ...(reason ? { reason } : {}),
      type: writingTypeOf(rule),
      rule,
      key,
      severity,
    },
    inferred: !isWritingRule(issue.rule) || !isWritingIssueKey(issue.key),
  }
}

export interface WritingFeedbackUpgrade {
  feedback: WritingFeedback
  inferred: number
  dropped: number
}

/** 纯函数：升级一条 feedback_json；返回 null 表示已经是 v2 / 无法解析。 */
export function upgradeWritingFeedback(raw: unknown): WritingFeedbackUpgrade | null {
  let feedback: unknown
  try {
    feedback = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return null
  }
  if (!feedback || typeof feedback !== 'object') return null
  const source = feedback as Record<string, unknown>
  if (source.version === 2) return null
  const issues: WritingIssue[] = []
  let inferred = 0
  let dropped = 0
  for (const item of Array.isArray(source.issues) ? source.issues : []) {
    const up = upgradeWritingIssue(item)
    if (!up.issue.suggestion) {
      dropped++
      continue
    }
    issues.push(up.issue)
    if (up.inferred) inferred++
  }
  return {
    feedback: {
      ...(source as unknown as WritingFeedback),
      version: 2,
      issues,
      recommendations: Array.isArray(source.recommendations) ? source.recommendations : [],
    },
    inferred,
    dropped,
  }
}
