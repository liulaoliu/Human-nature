import { inDictionary } from './dictionary'

/**
 * 清洗模块：把任意来源的原始文本，清成「每段一行、段间空行」的规范文本。
 *
 * 输入可能是：
 *   - PyMuPDF 抽取的正文（主路径）
 *   - 人工从 PDF 复制的文本（兜底）
 *   - OCR 结果（最低优先）
 *
 * 实测两期的伪影正好相反，都要覆盖：
 *   - 2021-06-12：软连字符 U+00AD 2807 个、ligature 1105 个、词内莫名空格
 *   - 2016-09-10：行末连字符 + 换行 2048 个、ligature 1042 个、词粘连
 *
 * 这里只处理「字符级 + 行结构」的确定性清理。词粘连（`emergingeconomies`）
 * 需要在 PyMuPDF 抽取端用词框间距修，TS 端不猜。
 */

/** PDF 里常见连字（ligature），NFKC 也会转，但显式映射更可控、可测。 */
const LIGATURES: Record<string, string> = {
  '\ufb00': 'ff',
  '\ufb01': 'fi',
  '\ufb02': 'fl',
  '\ufb03': 'ffi',
  '\ufb04': 'ffl',
  '\ufb05': 'ft',
  '\ufb06': 'st',
}

/**
 * 字符级归一化：
 *   1. 统一换行
 *   2. ligature → 普通字母
 *   3. 软连字符 U+00AD 删除并直接接合（它是「可选断点」，本不该占字符）
 *   4. 不换行空格 / 窄空格 → 普通空格
 *
 * 注意：软连字符若实为实义连字符（如 `shake\u00adup`），删掉会丢连字符，
 * 由人工通读修正；后续可用词典兜。
 */
export function normalizeTypography(input: string): string {
  let s = input.replace(/\r\n?/g, '\n')
  s = s.replace(/[\ufb00-\ufb06]/g, (c) => LIGATURES[c] ?? c)
  s = s.replace(/\u00ad/g, '')
  s = s.replace(/[\u00a0\u2007\u202f\u2009\u2028\u2029]/g, ' ')
  return s
}

/**
 * 行末连字符断词修复。
 *   `com-\npared`  → `compared`（去掉连字符后是词典里的词）
 *   `co-\nfounder` → `co-founder`（去掉连字符后不是词，保留连字符）
 * 下一行是空行时不合并（那是段落边界）。
 */
function dehyphenateLines(lines: string[]): string[] {
  const out: string[] = []
  for (const line of lines) {
    const prev = out[out.length - 1]
    const tail = prev !== undefined ? prev.match(/([A-Za-z]+)-[ \t]*$/) : null
    if (prev !== undefined && tail && line.trim() !== '') {
      const stem = tail[1]
      const nextWord = line.match(/^[ \t]*([A-Za-z]+)/)?.[1] ?? ''
      const joined = stem + nextWord
      const withoutDash = prev.replace(/-[ \t]*$/, '')
      out[out.length - 1] =
        nextWord && inDictionary(joined)
          ? withoutDash + line.replace(/^[ \t]+/, '')
          : prev.replace(/[ \t]*$/, '') + line.replace(/^[ \t]+/, '')
      continue
    }
    out.push(line)
  }
  return out
}

/**
 * 按空行切段落：段内所有物理行合成一行（用空格连接），段间空一行。
 *
 * 这同时覆盖了大纲里「合并行内硬换行」那条规则：既然每段最终输出为一行，
 * 段内的换行一律用空格接上，句末标点不会被粘掉字符。
 */
function groupParagraphs(lines: string[]): string {
  const paras: string[] = []
  let cur: string[] = []
  for (const line of lines) {
    if (line.trim() === '') {
      if (cur.length) {
        paras.push(cur.join(' '))
        cur = []
      }
    } else {
      cur.push(line.trim())
    }
  }
  if (cur.length) paras.push(cur.join(' '))
  return paras.join('\n\n')
}

/**
 * 清洗主入口：原始文本 → 规范文本（每段一行、段间空行）。
 *
 * 边界：空输入 / 纯空白 → `''`；单行原样返回；末尾有无换行都行。
 */
export function cleanText(raw: string): string {
  if (!raw) return ''
  const normalized = normalizeTypography(raw)
  if (normalized.trim() === '') return ''
  const lines = normalized.split('\n')
  return groupParagraphs(dehyphenateLines(lines))
}
