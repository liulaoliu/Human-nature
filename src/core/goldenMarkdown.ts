import { GOLDEN_TARGET_KIND_LABEL, goldenDrillKey, type GoldenTextMeta } from './golden'
import type { GoldenDrillRecord } from './goldenProgress'
import type { GoldenLesson } from '../types/document'

function mdText(s: string): string {
  return s.replace(/\r/g, '').replace(/`/g, '\\`')
}

/** 本课素材导出：干净 Markdown，方便贴到 Notion / 写作素材库。 */
export function goldenToMarkdown(
  lesson: GoldenLesson,
  opts: { title?: string; sentences?: GoldenTextMeta[]; records?: GoldenDrillRecord[]; articleId?: string; includeProgress?: boolean } = {},
): string {
  const textOf = new Map((opts.sentences ?? []).map((s) => [s.id, s.text]))
  const progress = new Map(
    (opts.records ?? [])
      .filter((r) => !opts.articleId || r.articleId === opts.articleId)
      .map((r) => [`${r.sentenceId}|${r.drillKey}`, r]),
  )
  const lines: string[] = []
  lines.push(`# ${mdText(opts.title || 'D老师小课堂')}`)
  if (lesson.summary) {
    lines.push('', mdText(lesson.summary))
  }
  if (lesson.outline.length) {
    lines.push('', '## 本篇脉络')
    for (const sec of lesson.outline) {
      const label = sec.role === 'intro' ? '开头段' : sec.role === 'conclusion' ? '结尾段' : '主体段'
      lines.push('', `### ${label}`)
      for (const p of sec.points) lines.push(`- ${mdText(p)}`)
    }
  }
  lines.push('', '## 金句')
  for (const s of lesson.sentences) {
    const text = textOf.get(s.id) ?? ''
    const rec = progress.get(`${s.id}|${goldenDrillKey(text, s.targets)}`)
    const mark = opts.includeProgress ? (rec?.mastered ? ' ✅' : '') : ''
    lines.push('', `### ${s.id}${mark}`)
    if (text) lines.push('', `**${mdText(text)}**`)
    if (s.zh) lines.push('', mdText(s.zh))
    if (s.pattern) lines.push('', `- 句型：${mdText(s.pattern)}`)
    if (s.tense) lines.push(`- 时态：${mdText(s.tense)}`)
    if (s.note) lines.push(`- 用法：${mdText(s.note)}`)
    if (s.targets.length) {
      lines.push('', '**学习点**')
      for (const t of s.targets) {
        lines.push(`- ${GOLDEN_TARGET_KIND_LABEL[t.kind]}：${mdText(t.en)}${t.zh ? ` — ${mdText(t.zh)}` : ''}`)
      }
    }
  }
  return lines.join('\n').trim() + '\n'
}
