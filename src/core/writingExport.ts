/**
 * 仿写批改记录的**成册导出**（A4 打印 + Markdown）。
 *
 * 为什么和 `core/writing.ts` 分开：那边是「出题 → 批改 → 存记录」的规则层，
 * 越写越长；导出只是把已有记录摊平成可打印 / 可存档的文本，两者改的理由完全不同
 * （改评分口径 vs 改版面）。记录叫什么的**口径**仍留在 `writing.ts` 的
 * `writingRecordLabel`，这里只调用，不另写一份来源/稿次判断。
 *
 * 纯函数：不读 DOM、不看当前文章，导出的是传进来的那批记录。
 */
import type { WritingRecord } from './writing'
import { writingRecordLabel } from './writing'
import { a4Document, escapeHtml } from './printHtml'

function mdText(s: string): string {
  return s.replace(/\r/g, '').trim()
}

/**
 * 仿写批改记录 → A4 打印 HTML（**成册**用，和「全库金句本」一个路子）。
 *
 * 单栏密排：每条记录 = 日期 · 来源 · 文章，下面是范句 / 我的作答 / 分数 /
 * 逐条问题 / 润色 / 总评。`break-inside: avoid` 保证一条不会被撕成两页。
 */
export function writingHistoryToPrintHTML(records: WritingRecord[], title = '仿写批改记录'): string {
  const list = [...records].sort((a, b) => b.at.localeCompare(a.at))
  const body = list
    .map((r) => {
      const when = r.at.replace('T', ' ').slice(0, 16)
      const src = writingRecordLabel(r)
      const fb = r.feedback
      const scores = (fb.scores ?? [])
        .map((s) => `${escapeHtml(mdText(s.dimension))} ${s.score}/${s.max}${s.comment ? `（${escapeHtml(mdText(s.comment))}）` : ''}`)
        .join('；')
      const issues = (fb.issues ?? [])
        .map((i) => `${escapeHtml(mdText(i.original))} → ${escapeHtml(mdText(i.suggestion))}${i.reason ? `（${escapeHtml(mdText(i.reason))}）` : ''}`)
        .map((t) => `<li>${t}</li>`)
        .join('')
      return `<div class="item">
        <div class="head">${escapeHtml(when)} · ${escapeHtml(src)}${r.articleTitle ? ` · ${escapeHtml(r.articleTitle)}` : ''}${
          fb.max > 0 ? ` · ${fb.total}/${fb.max}` : ''
        }</div>
        ${r.task?.model || r.model ? `<div class="model">范句：${escapeHtml(mdText(r.task?.model || r.model))}</div>` : ''}
        ${r.task?.task ? `<div class="task">题目：${escapeHtml(mdText(r.task.task))}</div>` : ''}
        ${r.text ? `<div class="answer">作答：${escapeHtml(mdText(r.text))}</div>` : ''}
        ${scores ? `<div class="scores">评分：${scores}</div>` : ''}
        ${issues ? `<ul class="issues">${issues}</ul>` : ''}
        ${fb.polished ? `<div class="polished">润色：${escapeHtml(mdText(fb.polished))}</div>` : ''}
        ${fb.summary ? `<div class="summary">总评：${escapeHtml(mdText(fb.summary))}</div>` : ''}
      </div>`
    })
    .join('')

  return a4Document({
    title,
    margin: '12mm',
    fontSize: '9.5pt',
    lineHeight: '1.45',
    css: `h1 { font-size: 14pt; margin: 0 0 2mm; }
.meta { color: #666; font-size: 8pt; margin: 0 0 4mm; }
.item { break-inside: avoid; padding: 0 0 3mm; margin: 0 0 3mm; border-bottom: .3pt solid #ddd; }
.head { color: #555; font-size: 8pt; margin-bottom: .8mm; }
.model { color: #333; font-style: italic; }
.model, .task, .answer, .scores, .polished, .summary { margin-top: .6mm; }
.answer { font-weight: 600; }
.scores, .polished { color: #333; }
.issues { margin: 1mm 0 0 4mm; padding: 0; font-size: 8.5pt; }
.issues li { margin: 0 0 .5mm; }
.summary { color: #444; font-size: 8.5pt; }`,
    body: `<h1>${escapeHtml(title)}</h1>
<div class="meta">共 ${list.length} 条 · ${list.filter((r) => r.feedback.max > 0).length} 条有评分</div>
${body}`,
  })
}

/**
 * 仿写批改记录 → Markdown（**成册**用）。
 *
 * AI 批改（分数 / 逐条问题 / 润色 / 总评）只存在 `writing_records.feedback` 里，
 * 界面上只在交卷那一刻显示；这里按时间倒序摊平成一份可直接存档 / 打印的稿子。
 * 纯函数：不读 DOM、不看当前文章，导出的是全库记录。
 */
export function writingHistoryToMarkdown(records: WritingRecord[], title = '仿写批改记录'): string {
  const list = [...records].sort((a, b) => b.at.localeCompare(a.at))
  const lines: string[] = [`# ${title}`, '', `共 ${list.length} 条`]
  for (const r of list) {
    const when = r.at.replace('T', ' ').slice(0, 16)
    const src = writingRecordLabel(r)
    lines.push('', `## ${when} · ${mdText(r.articleTitle || r.articleId) || '未命名'}（${src}）`)
    if (r.task?.model || r.model) lines.push('', `**范句**：${mdText(r.task?.model || r.model)}`)
    if (r.task?.task) lines.push('', `**题目**：${mdText(r.task.task)}`)
    if (r.text) lines.push('', `**我的作答**：${mdText(r.text)}`)
    const fb = r.feedback
    if (fb.max > 0) lines.push('', `**评分**：${fb.total}/${fb.max}`)
    for (const s of fb.scores ?? []) {
      lines.push(`- ${mdText(s.dimension)} ${s.score}/${s.max}${s.comment ? ` — ${mdText(s.comment)}` : ''}`)
    }
    if (fb.issues?.length) {
      lines.push('', '**问题**')
      for (const i of fb.issues) {
        lines.push(`- 「${mdText(i.original)}」→「${mdText(i.suggestion)}」${i.reason ? ` — ${mdText(i.reason)}` : ''}`)
      }
    }
    if (fb.polished) lines.push('', `**润色版**：${mdText(fb.polished)}`)
    if (fb.summary) lines.push('', `**总评**：${mdText(fb.summary)}`)
  }
  return lines.join('\n').trim() + '\n'
}
