/**
 * 选字定块：把鼠标选区换算成原文的词序号区间。
 *
 * UI 层只负责量出「选区两端在整段文字里的字符下标」，剩下的换算放这里，
 * 不碰 DOM，方便单测。
 *
 * 这样比按 DOM 子节点去猜更稳（选区端点常常落在元素节点上、或在段与段交界）。
 */

/**
 * @param text        整块文本（各段拼起来，词之间单空格）
 * @param startOffset 选区起点在 text 里的字符下标
 * @param endOffset   选区终点在 text 里的字符下标
 */
export function wordRangeFromText(
  text: string,
  startOffset: number,
  endOffset: number,
): [number, number] | null {
  const len = text.length
  let a = Math.max(0, Math.min(Math.round(startOffset), len))
  let b = Math.max(0, Math.min(Math.round(endOffset), len))
  if (a > b) [a, b] = [b, a]
  if (b <= a) return null // 光标 / 空选区

  const total = countWords(text)
  const from = caretWordIndex(text.slice(0, a))
  const endPrefix = text.slice(0, b)
  // 终点落在词中间/词尾时把它算进来（+1）；正好落在空格后就不算
  const tail = /\s$/.test(endPrefix) ? 0 : 1
  const to = Math.min(total, caretWordIndex(endPrefix) + tail)
  if (to <= from) return null
  return [from, to]
}

/**
 * 一个文字边界落在第几个词上（相对它所在文本的开头）。
 * - 以空白结尾 = 已经跨过前一个词，落在下一个词开头
 * - 否则 = 落在这个词上（词中间或词尾）
 *
 * 例（文本 "aa bb cc "）：
 *   ""            → 0
 *   "aa"          → 0  （在第一个词里）
 *   "aa "         → 1  （跨过第一个词）
 *   "aa bb"       → 1
 *   "aa bb "      → 2
 */
export function caretWordIndex(prefix: string): number {
  if (!prefix) return 0
  if (/\s$/.test(prefix)) return countWords(prefix)
  const spaces = prefix.match(/\s/g)
  return spaces ? spaces.length : 0
}

function countWords(text: string): number {
  const t = text.trim()
  return t ? t.split(/\s+/).length : 0
}
