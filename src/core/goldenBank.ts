import { dayKeyLocal } from './activity'
import { GOLDEN_TARGET_KIND_LABEL, goldenDrillKey, goldenTargetsFor } from './golden'
import { findGoldenRecord, goldenReviewDue, type GoldenDrillRecord } from './goldenProgress'
import type { GoldenLesson, GoldenTarget, GoldenTargetKind } from '../types/document'

/**
 * 全库金句本：把每篇的 `SavedArticle.golden` 摊平成可搜索、可筛选、可导出的行。
 *
 * 事实来源仍是文章里的 golden + 学习记录里的 goldenDrills；这里只读、不写。
 * 默认按文章标题 / 原文顺序排，方便当成写作素材库。
 */

export interface GoldenBankSource {
  /** 稳定文章标识：已保存用 SavedArticle.id，当前未保存用 articleKey/title */
  id: string
  title: string
  sentences: { id: string; text: string; translation?: string | null }[]
  golden?: GoldenLesson
}

export interface GoldenBankRow {
  articleId: string
  articleTitle: string
  sentenceId: string
  text: string
  zh?: string
  pattern?: string
  tense?: string
  note?: string
  targets: GoldenTarget[]
  mastered: boolean
  /** 最近一次学习/回顾时间 ISO */
  lastAt?: string
  /** 已掌握、但今天还没回顾 */
  due: boolean
}

export type GoldenBankStatus = 'all' | 'todo' | 'mastered' | 'due'

/**
 * 按「学习点类型」筛：一句里只要有一个该类型的学习点就算命中。
 * 金句页的主要噪音来源是「这句我要找的是搭配/句型」，按状态筛不解决问题。
 */
export type GoldenBankKind = 'all' | GoldenTargetKind

/** 摊平所有文章的金句；没有 golden 的文章不出现。 */
export function buildGoldenBank(
  sources: GoldenBankSource[],
  records: GoldenDrillRecord[],
  now: Date = new Date(),
): GoldenBankRow[] {
  const today = dayKeyLocal(now)
  const rows: GoldenBankRow[] = []
  for (const source of sources) {
    const lesson = source.golden
    if (!lesson) continue
    const byId = new Map(source.sentences.map((s) => [s.id, s]))
    const selected = lesson.selected.length ? lesson.selected : lesson.sentences.map((s) => s.id)
    for (const id of selected) {
      const content = lesson.sentences.find((s) => s.id === id)
      const sentence = byId.get(id)
      if (!content || !sentence) continue
      const targets = goldenTargetsFor(lesson, id)
      const rec = findGoldenRecord(records, source.id, id, goldenDrillKey(sentence.text, targets))
      const mastered = rec?.mastered === true
      const lastAt = rec?.at
      rows.push({
        articleId: source.id,
        articleTitle: source.title || '未命名',
        sentenceId: id,
        text: sentence.text,
        ...(content.zh || sentence.translation ? { zh: content.zh || sentence.translation || undefined } : {}),
        ...(content.pattern ? { pattern: content.pattern } : {}),
        ...(content.tense ? { tense: content.tense } : {}),
        ...(content.note ? { note: content.note } : {}),
        targets,
        mastered,
        ...(lastAt ? { lastAt } : {}),
        due: goldenReviewDue(rec, today),
      })
    }
  }
  const order = new Map(sources.map((s, i) => [s.id, i]))
  return rows.sort(
    (a, b) =>
      (order.get(a.articleId) ?? 0) - (order.get(b.articleId) ?? 0) ||
      a.sentenceId.localeCompare(b.sentenceId),
  )
}

/** 金句本搜索 / 状态筛选；不改变原数组。 */
export function filterGoldenBank(
  rows: GoldenBankRow[],
  opts: { query?: string; status?: GoldenBankStatus; kind?: GoldenBankKind } = {},
): GoldenBankRow[] {
  const q = (opts.query ?? '').trim().toLowerCase()
  const status = opts.status ?? 'all'
  const kind = opts.kind ?? 'all'
  return rows.filter((r) => {
    if (status === 'mastered' && !r.mastered) return false
    if (status === 'todo' && r.mastered) return false
    if (status === 'due' && !r.due) return false
    if (kind !== 'all' && !r.targets.some((t) => t.kind === kind)) return false
    if (!q) return true
    const hay = [r.text, r.zh, r.pattern, r.tense, r.note, ...r.targets.map((t) => `${t.en} ${t.zh ?? ''}`)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
}

function markdownText(s: string): string {
  return s.replace(/\r/g, '').replace(/`/g, '\\`')
}

/** 金句本导出 Markdown：按文章分组，方便贴进写作素材库。 */
export function goldenBankToMarkdown(rows: GoldenBankRow[], title = '全库金句本'): string {
  const lines: string[] = [`# ${markdownText(title)}`, '', `共 ${rows.length} 句 · ${rows.filter((r) => r.mastered).length} 句已掌握`]
  let current = ''
  for (const r of rows) {
    if (r.articleTitle !== current) {
      current = r.articleTitle
      lines.push('', `## ${markdownText(current)}`)
    }
    lines.push('', `### ${r.mastered ? '✅ ' : ''}${r.sentenceId}`)
    lines.push('', `**${markdownText(r.text)}**`)
    if (r.zh) lines.push('', markdownText(r.zh))
    if (r.pattern) lines.push('', `- 句型：${markdownText(r.pattern)}`)
    if (r.tense) lines.push(`- 时态：${markdownText(r.tense)}`)
    if (r.note) lines.push(`- 用法：${markdownText(r.note)}`)
    if (r.targets.length) {
      lines.push('', '**学习点**')
      for (const t of r.targets) {
        lines.push(`- ${GOLDEN_TARGET_KIND_LABEL[t.kind]}：${markdownText(t.en)}${t.zh ? ` — ${markdownText(t.zh)}` : ''}`)
      }
    }
  }
  return lines.join('\n').trim() + '\n'
}

function csvField(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 金句本 A4 讲义：两栏密排，打印后就是一张写作素材纸。 */
export function goldenBankToPrintHTML(rows: GoldenBankRow[], title = '全库金句本'): string {
  const body = rows
    .map((r) => {
      const targets = r.targets
        .map((t) => `${GOLDEN_TARGET_KIND_LABEL[t.kind]} ${escapeHtml(t.en)}${t.zh ? `（${escapeHtml(t.zh)}）` : ''}`)
        .join('；')
      return `<div class="item">
        <div class="head">${r.mastered ? '✅ ' : ''}${escapeHtml(r.articleTitle)} · ${escapeHtml(r.sentenceId)}</div>
        <div class="en">${escapeHtml(r.text)}</div>
        ${r.zh ? `<div class="zh">${escapeHtml(r.zh)}</div>` : ''}
        ${r.pattern ? `<div class="note">句型：${escapeHtml(r.pattern)}</div>` : ''}
        ${r.tense ? `<div class="note">时态：${escapeHtml(r.tense)}</div>` : ''}
        ${targets ? `<div class="note">学习点：${targets}</div>` : ''}
      </div>`
    })
    .join('')
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
@page { size: A4; margin: 10mm; }
html, body { margin: 0; }
body { font-family: "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif; color: #111; font-size: 9pt; line-height: 1.4; }
h1 { font-size: 14pt; margin: 0 0 2mm; }
.meta { color: #666; font-size: 8pt; margin: 0 0 3mm; }
.items { columns: 2; column-gap: 6mm; column-rule: .3pt solid #ddd; }
.item { break-inside: avoid; margin: 0 0 3mm; }
.head { color: #666; font-size: 7.5pt; }
.en { font-weight: 600; margin-top: .5mm; }
.zh { color: #333; }
.note { color: #555; font-size: 8pt; }
</style></head><body>
<h1>${escapeHtml(title)}</h1>
<div class="meta">共 ${rows.length} 句 · ${rows.filter((r) => r.mastered).length} 句已掌握</div>
<div class="items">${body}</div>
</body></html>`
}

/** 金句本导出 Anki CSV：正面整句，背面中文 + 句型/时态 + 学习点。 */
export function goldenBankToAnkiCSV(rows: GoldenBankRow[], header = true): string {
  const out: string[] = header ? ['Front,Back,Tags'] : []
  for (const r of rows) {
    const back = [
      r.zh ?? '',
      r.pattern ? `句型：${r.pattern}` : '',
      r.tense ? `时态：${r.tense}` : '',
      r.targets.length
        ? `学习点：${r.targets.map((t) => `${GOLDEN_TARGET_KIND_LABEL[t.kind]} ${t.en}${t.zh ? `（${t.zh}）` : ''}`).join('；')}`
        : '',
    ]
      .filter(Boolean)
      .join('<br>')
    const tags = ['golden', r.articleTitle].map((t) => t.replace(/\s+/g, '_').replace(/,/g, '_')).join(' ')
    out.push([r.text, back, tags].map(csvField).join(','))
  }
  return out.join('\n') + (out.length ? '\n' : '')
}
