import JSZip from 'jszip'

/**
 * 浏览器内文档导入：PDF（pdf.js）与 EPUB（jszip）。
 *
 * 只负责"把文本弄出来"，清洗/切句交给 core/cleaner + core/segmenter。
 * 注意：整期 Economist 的分篇仍要靠离线 tools/extract-articles.py（字体+版面几何），
 * 这里适合单篇 PDF、书、格式规整的文档。
 */

interface PdfTextItem {
  str: string
  transform?: number[]
  height?: number
  hasEOL?: boolean
}

/** `14-16,20` → [14,15,16,20]；空则全文。 */
export function parsePageRange(range: string | undefined, total: number): number[] {
  if (!range || !range.trim()) return Array.from({ length: total }, (_, i) => i + 1)
  const out = new Set<number>()
  for (const part of range.split(',')) {
    const m = part.trim().match(/^(\d+)\s*-\s*(\d+)$/)
    if (m) {
      const a = Number(m[1])
      const b = Number(m[2])
      for (let i = Math.max(1, a); i <= Math.min(total, b); i++) out.add(i)
    } else if (/^\d+$/.test(part.trim())) {
      const n = Number(part.trim())
      if (n >= 1 && n <= total) out.add(n)
    }
  }
  return [...out].sort((a, b) => a - b)
}

/** 一页的文本项 → 文本；靠纵向间距断行、大的间距当段落。 */
export function itemsToText(items: unknown[]): string {
  const lines: string[] = []
  let cur = ''
  let lastY: number | null = null
  let lastH = 10
  for (const raw of items) {
    const it = raw as PdfTextItem
    if (typeof it.str !== 'string') continue
    const y: number = it.transform?.[5] ?? lastY ?? 0
    const h = it.height ?? lastH
    if (lastY !== null && Math.abs(y - lastY) > h * 0.8) {
      if (cur.trim()) lines.push(cur.trim())
      cur = ''
      if (Math.abs(y - lastY) > h * 1.8) lines.push('')
    }
    cur += it.str
    if (it.hasEOL) {
      if (cur.trim()) lines.push(cur.trim())
      cur = ''
    }
    lastY = y
    lastH = h
  }
  if (cur.trim()) lines.push(cur.trim())
  return lines.join('\n')
}

/** 抽 PDF 文本（可指定页码范围）。 */
export async function extractPdfText(file: File, pageRange?: string): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const pages = parsePageRange(pageRange, doc.numPages)
  const out: string[] = []
  try {
    for (const pno of pages) {
      const page = await doc.getPage(pno)
      const content = await page.getTextContent()
      out.push(itemsToText(content.items))
    }
  } finally {
    await (doc as unknown as { destroy?: () => Promise<void> }).destroy?.()
  }
  return out.join('\n\n')
}

/** HTML/XHTML → {标题, 正文}（按块元素分段）。 */
export function htmlToText(html: string): { title: string; text: string } {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script,style,head').forEach((el) => el.remove())
  const title = (doc.querySelector('h1,h2,h3,title')?.textContent ?? '').replace(/\s+/g, ' ').trim()
  const blocks = [...doc.querySelectorAll('p,h1,h2,h3,h4,li,blockquote')]
    .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const text = blocks.length ? blocks.join('\n\n') : (doc.body?.textContent ?? '').replace(/[ \t]+/g, ' ').trim()
  return { title, text }
}

/** 解析 OPF 的 spine + manifest，得到按阅读顺序的章节文件。 */
export function parseOpf(opf: string, opfPath: string): string[] {
  const doc = new DOMParser().parseFromString(opf, 'application/xml')
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
  const manifest = new Map<string, string>()
  doc.querySelectorAll('manifest > item').forEach((el) => {
    const id = el.getAttribute('id')
    const href = el.getAttribute('href')
    if (id && href) manifest.set(id, base + href)
  })
  const out: string[] = []
  doc.querySelectorAll('spine > itemref').forEach((el) => {
    const idref = el.getAttribute('idref')
    const href = idref ? manifest.get(idref) : undefined
    if (href) out.push(href)
  })
  return out
}

/** 抽 EPUB：按 spine 顺序返回 [{title, text}]，一章一条。 */
export async function extractEpub(file: File): Promise<{ title: string; text: string }[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const container = await zip.file('META-INF/container.xml')?.async('string')
  const opfPath = container?.match(/full-path="([^"]+)"/)?.[1] ?? ''
  let hrefs: string[] = []
  if (opfPath) {
    const opf = await zip.file(opfPath)?.async('string')
    if (opf) hrefs = parseOpf(opf, opfPath)
  }
  if (!hrefs.length) {
    hrefs = Object.keys(zip.files)
      .filter((n) => /\.(x?html?|xhtml)$/i.test(n))
      .sort()
  }
  const out: { title: string; text: string }[] = []
  for (const href of hrefs) {
    const raw = await zip.file(href)?.async('string')
    if (!raw) continue
    const { title, text } = htmlToText(raw)
    if (text.trim()) out.push({ title, text })
  }
  return out
}
