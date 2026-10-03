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
 * A4 打印用的完整 HTML（三栏密排，一页约 100+ 词）。
 * 在浏览器里打开后「打印 → 另存为 PDF」即可。
 *
 * `numberOf` 给出每个词条的序号（和正文/生词本对应）；不传则按打印顺序 1,2,3…
 */
export function renderPrintHTML(input: {
  title: string
  groups: VocabGroup[]
  /** 标题下的一行小字（日期 / 数量等） */
  subtitle?: string
  /** 序号；不传或返回 null 就不编号（全库打印不编号） */
  numberOf?: (item: VocabItem) => number | null
}): string {
  const seen = new Set<string>()
  let count = 0
  const body = input.groups
    .map((g) => {
      const items = g.items
        .filter((it) => {
          if (seen.has(it.lemma)) return false
          seen.add(it.lemma)
          count += 1
          return true
        })
        .map((it) => {
          const n = input.numberOf ? input.numberOf(it) : null
          const no = n != null ? `<span class="no">${n}</span>` : ''
          const phonetic = it.phonetic ? ` <span class="phon">${escapeHtml(it.phonetic)}</span>` : ''
          const pos = it.partOfSpeech ? ` <span class="pos">${escapeHtml(it.partOfSpeech)}</span>` : ''
          const meaning = it.meaning ? ` <span class="meaning">${escapeHtml(it.meaning)}</span>` : ''
          const usage = it.usage.length
            ? ` <span class="usage">· ${it.usage.map(escapeHtml).join('；')}</span>`
            : ''
          return `<div class="item">${no}<span class="word">${escapeHtml(it.word)}</span>${phonetic}${pos}${meaning}${usage}</div>`
        })
        .join('')
      return items ? `${g.key ? `<h2>${escapeHtml(g.key)}</h2>` : ''}${items}` : ''
    })
    .join('')

  const meta = input.subtitle ?? `${count} 词`
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>${escapeHtml(input.title)}</title>
<style>
  @page { size: A4; margin: 10mm; }
  html, body { margin: 0; }
  body {
    font-family: "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
    font-size: 8pt;
    line-height: 1.35;
    color: #111;
  }
  h1 { font-size: 12pt; margin: 0 0 1mm; }
  .meta { font-size: 7.5pt; color: #666; margin: 0 0 3mm; }
  h2 {
    font-size: 8.5pt;
    margin: 2.5mm 0 1mm;
    padding-bottom: 0.5mm;
    border-bottom: 0.4pt solid #bbb;
    break-after: avoid;
  }
  .items { columns: 3; column-gap: 5mm; column-rule: 0.3pt solid #ddd; }
  .item { break-inside: avoid; margin-bottom: 0.7mm; }
  .no {
    display: inline-block;
    min-width: 4.5mm;
    color: #888;
    font-variant-numeric: tabular-nums;
  }
  .word { font-weight: 700; }
  .phon { color: #555; }
  .pos { color: #777; font-style: italic; }
  .usage { color: #555; }
  @media print { .items { columns: 3; } }
</style>
</head>
<body>
<h1>${escapeHtml(input.title)}</h1>
<div class="meta">${escapeHtml(meta)}</div>
<div class="items">
${body}
</div>
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
