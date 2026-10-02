import type { EconomistDocument, VocabItem, VocabLibrary } from '../types/document'
import { SCHEMA_VERSION } from '../types/document'
import type { VocabGroup } from './vocab'

/**
 * 导出层：A4 打印 / Anki CSV / 标准 JSON。
 *
 * 全是纯函数，方便单测，也方便在浏览器/Node 里复用。
 * 数据来源统一是词库（VocabItem）与文档（EconomistDocument）。
 */

function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** 按 lemma 去重（输出前的保险，避免同一词重复出现在卡片/打印里）。 */
export function dedupeByLemma(items: VocabItem[]): VocabItem[] {
  const seen = new Set<string>()
  const out: VocabItem[] = []
  for (const it of items) {
    if (seen.has(it.lemma)) continue
    seen.add(it.lemma)
    out.push(it)
  }
  return out
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Anki 标签里不能有空格，统一换成下划线。 */
function ankiTag(value: string): string {
  return value.trim().replace(/\s+/g, '_').replace(/,/g, '_')
}

/**
 * 导出 Anki 导入用的 CSV（三列：Front, Back, Tags）。
 * 正反两面用 `<br>` 换行，Anki 会当富文本渲染。
 */
export function toAnkiCSV(items: VocabItem[], opts?: { header?: boolean }): string {
  const rows: string[] = []
  if (opts?.header ?? true) rows.push(['Front', 'Back', 'Tags'].map(csvField).join(','))
  for (const it of dedupeByLemma(items)) {
    const front = [it.word, it.phonetic].filter(Boolean).join(' ')
    const back: string[] = []
    if (it.partOfSpeech) back.push(it.partOfSpeech)
    if (it.meaning) back.push(it.meaning)
    if (it.usage.length) back.push(it.usage.join('<br>'))
    for (const ex of it.examples) {
      back.push([ex.text, ex.translation].filter(Boolean).join('<br>'))
    }
    const tags = [...it.tags, it.source?.articleId ?? ''].filter(Boolean).map(ankiTag).join(' ')
    rows.push([front, back.join('<br>'), tags].map(csvField).join(','))
  }
  return rows.join('\n')
}

/** 导出词库 JSON（标准结构，不做额外包装）。 */
export function exportLibraryJSON(library: VocabLibrary): string {
  return JSON.stringify(library, null, 2)
}

/** 从 JSON 导入词库，校验结构并补 schemaVersion。 */
export function importLibraryJSON(raw: string): VocabLibrary {
  const value = JSON.parse(raw) as Partial<VocabLibrary>
  if (!value || typeof value !== 'object' || !Array.isArray(value.items)) {
    throw new Error('词库 JSON 结构不对：缺少 items 数组')
  }
  return { schemaVersion: value.schemaVersion ?? SCHEMA_VERSION, items: value.items }
}

/** 导出文档 JSON，供外部音频模块直接消费。 */
export function exportDocumentJSON(doc: EconomistDocument): string {
  return JSON.stringify(doc, null, 2)
}

/** 从 JSON 导入文档。 */
export function importDocumentJSON(raw: string): EconomistDocument {
  const value = JSON.parse(raw) as Partial<EconomistDocument>
  if (!value || typeof value !== 'object' || !Array.isArray(value.sentences) || !Array.isArray(value.paragraphs)) {
    throw new Error('文档 JSON 结构不对：缺少 paragraphs / sentences')
  }
  return { schemaVersion: value.schemaVersion ?? SCHEMA_VERSION, meta: value.meta!, paragraphs: value.paragraphs, sentences: value.sentences }
}

/**
 * A4 打印用的完整 HTML（自带 `@media print` 与两栏排版）。
 * 在浏览器里打开后「打印 → 另存为 PDF」即可。
 */
export function renderPrintHTML(input: { title: string; groups: VocabGroup[] }): string {
  const seen = new Set<string>()
  const groups = input.groups
    .map((g) => {
      const items = g.items
        .filter((it) => {
          if (seen.has(it.lemma)) return false
          seen.add(it.lemma)
          return true
        })
        .map((it) => {
          const phonetic = it.phonetic ? ` <span class="phon">${escapeHtml(it.phonetic)}</span>` : ''
          const pos = it.partOfSpeech ? ` <span class="pos">${escapeHtml(it.partOfSpeech)}</span>` : ''
          const meaning = it.meaning ? `<div class="meaning">${escapeHtml(it.meaning)}</div>` : ''
          const usage = it.usage.length
            ? `<div class="usage">${it.usage.map(escapeHtml).join('；')}</div>`
            : ''
          const examples = it.examples
            .slice(0, 2)
            .map(
              (ex) =>
                `<div class="example">${escapeHtml(ex.text)}${
                  ex.translation ? `<span class="trans">${escapeHtml(ex.translation)}</span>` : ''
                }</div>`,
            )
            .join('')
          return `<div class="item"><div class="word">${escapeHtml(it.word)}${phonetic}${pos}</div>${meaning}${usage}${examples}</div>`
        })
        .join('')
      return `<section class="group"><h2>${escapeHtml(g.key)}</h2><div class="items">${items}</div></section>`
    })
    .join('')

  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>${escapeHtml(input.title)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: Georgia, "Songti SC", serif; font-size: 11pt; color: #111; margin: 0; }
  h1 { font-size: 16pt; margin: 0 0 6mm; }
  h2 { font-size: 12pt; border-bottom: 1px solid #999; margin: 5mm 0 2mm; }
  .items { columns: 2; column-gap: 8mm; }
  .item { break-inside: avoid; margin-bottom: 3.5mm; }
  .word { font-weight: bold; }
  .phon { color: #555; font-weight: normal; }
  .pos { color: #777; font-style: italic; font-size: 9pt; }
  .meaning { }
  .usage { color: #333; }
  .example { color: #333; font-size: 10pt; }
  .trans { color: #666; margin-left: 4px; }
  @media print { .items { columns: 2; } }
</style>
</head>
<body>
<h1>${escapeHtml(input.title)}</h1>
${groups}
</body>
</html>`
}

/** 导出「待选生词」CSV（两列：Word, Context）。 */
export function toWordsCSV(entries: { word: string; context?: string }[]): string {
  const rows = ['Word,Context']
  const seen = new Set<string>()
  for (const e of entries) {
    const key = e.word.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    rows.push([e.word, e.context ?? ''].map(csvField).join(','))
  }
  return rows.join('\n')
}

/** 导出错词本 CSV（词 / 出错次数 / 含义 / 来源句）。 */
export function toWrongWordsCSV(items: VocabItem[]): string {
  const rows = ['Word,Lapses,Meaning,Context']
  for (const it of dedupeByLemma(items).filter((x) => (x.reviewState.lapses ?? 0) > 0)) {
    rows.push(
      [it.word, String(it.reviewState.lapses ?? 0), it.meaning ?? '', it.source?.sentenceText ?? '']
        .map(csvField)
        .join(','),
    )
  }
  return rows.join('\n')
}
