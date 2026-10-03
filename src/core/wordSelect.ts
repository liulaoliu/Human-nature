/**
 * 按词吸附选区。
 *
 * 阅读时用鼠标很难刚好停在词边界：想选 "abandon back"，终点常常落在 back 的
 * b / a / c / k 上。这里把选区两端扩到**整词**，于是只要碰到某个词（哪怕只碰到
 * 首字母），那个词就算整个被选中；没碰到就不算。
 *
 * 纯函数，不碰 DOM，方便单测。DOM 那边负责把字符偏移量算出来再喂进来。
 */

export interface WordSpan {
  /** 在原文里的起始字符下标 */
  start: number
  /** 结束字符下标（开区间） */
  end: number
  text: string
}

/** 连字符（ASCII `-` 和 Unicode `‐`）；en/em dash 不算复合词，避免误并。 */
const HYPHEN = /^[-\u2010]$/

/** 把「词-词」这种连字符复合词并成一个词（bad-tempered、burqa-clad）。 */
function mergeHyphenated(text: string, spans: WordSpan[]): WordSpan[] {
  const out: WordSpan[] = []
  for (const w of spans) {
    const prev = out[out.length - 1]
    if (prev && HYPHEN.test(text.slice(prev.end, w.start))) {
      prev.end = w.end
      prev.text = text.slice(prev.start, prev.end)
    } else {
      out.push({ ...w })
    }
  }
  return out
}

/** 切出所有「词」（含字母或数字的片段），标点和空白不算词。 */
export function wordSpans(text: string): WordSpan[] {
  const Segmenter = (Intl as unknown as { Segmenter?: unknown }).Segmenter
  if (typeof Segmenter === 'function') {
    const seg = new (Segmenter as new (
      locale: string,
      opts: { granularity: string },
    ) => { segment(input: string): Iterable<{ segment: string; index: number }> })('en', {
      granularity: 'word',
    })
    const out: WordSpan[] = []
    for (const s of seg.segment(text)) {
      if (/[\p{L}\p{N}]/u.test(s.segment)) {
        out.push({ start: s.index, end: s.index + s.segment.length, text: s.segment })
      }
    }
    return mergeHyphenated(text, out)
  }
  // 兜底：按非字母数字切
  const out: WordSpan[] = []
  const re = /[\p{L}\p{N}]+/gu
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push({ start: m.index, end: m.index + m[0].length, text: m[0] })
  return mergeHyphenated(text, out)
}

/**
 * 把区间 [start, end) 扩到整词。
 *   - 只落在某个词里 → 返回那个词
 *   - 跨了多个词 → 返回首词到末词（中间全包）
 *   - 落在标点/空白里 → 就近归到旁边的词
 * start/end 顺序无所谓；没有词时返回 null。
 */
export function snapSelection(text: string, start: number, end: number): WordSpan | null {
  const spans = wordSpans(text)
  if (!spans.length) return null
  const lo = Math.max(0, Math.min(start, end))
  const hi = Math.max(0, Math.max(start, end))

  const first =
    spans.find((w) => lo >= w.start && lo < w.end) ?? spans.find((w) => w.start >= lo) ?? spans[spans.length - 1]
  // hi 是开区间：看 hi-1 落在哪个词里，这样正好停在词边界时不会多包一个词
  const edge = hi > lo ? hi - 1 : lo
  const last =
    spans.find((w) => edge >= w.start && edge < w.end) ?? spans.filter((w) => w.end <= hi).pop() ?? first

  const from = Math.min(spans.indexOf(first), spans.indexOf(last))
  const to = Math.max(spans.indexOf(first), spans.indexOf(last))
  return { start: spans[from].start, end: spans[to].end, text: text.slice(spans[from].start, spans[to].end) }
}
