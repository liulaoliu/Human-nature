import { applyLanguage, parseLanguage } from '../../core/language'
import type { ApplyContext, ApplyOutcome } from './types'

/** 逐句语言点：写回句子，并报告 AI 漏掉的句子。 */
export function applyLanguageTask(ctx: ApplyContext): ApplyOutcome {
  const rows = parseLanguage(ctx.text)
  if (!rows.length)
    return { report: ['没解析出语言点（需要 JSON：{"sentences":[{"id":…}] }）'], missing: null, ok: false }
  ctx.setDoc((d) => (d ? { ...d, sentences: applyLanguage(d.sentences, rows) } : d))
  ctx.setPendingSave(true)
  ctx.recordActivity('write', rows.length)
  const got = new Set(rows.map((r) => r.id))
  const missing = ctx.askedIds.filter((id) => !got.has(id))
  const report = [`已写入 ${rows.length} 句语言点`]
  if (missing.length) {
    report.push(`AI 未返回 ${missing.length} 句：${missing.slice(0, 20).join('、')}${missing.length > 20 ? '…' : ''}`)
  }
  return { report, missing: null, ok: true }
}
