import { lemmaOf } from './vocab'
import { wordSpans } from './wordSelect'
import type { VocabItem } from '../types/document'

/**
 * 出题用的「题干素材」：答案归一化 / 挖空 / 干扰项 / 语法标记 / 洗牌。
 *
 * 从 `quiz.ts` 抽出来的原因：这些都是无状态纯函数，跟「题型有哪些」「怎么判分」
 * 不是一件事；`quiz.ts` 里 `makeQuestion` 的巨型分支已经够长，素材工具混在里面
 * 很难找。这里只管「把词条变成可考的题干与选项」，不判分、不碰界面。
 */

/**
 * 填空题的「形状提示」：把字母/数字换成下划线，保留空格、连字符、撇号。
 * 例如 `bad-temperedly` → `___-___________`，`run a business` → `___ _ ________`。
 * 只暗示长度（几个字母、几个词），不泄露任何字母。
 */
export function maskAnswer(answer: string): string {
  return answer.replace(/[A-Za-z0-9]/g, '_')
}

/** 归一化作答：小写、去首尾标点、压缩空白。 */
export function normalizeAnswer(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/^[.!?,;:"'“”‘’()[\]{}]+/, '')
    .replace(/[.!?,;:"'“”‘’()[\]{}]+$/, '')
    .replace(/\s+/g, ' ')
}

/** 只留字母数字（用于宽容比较：忽略连字符、撇号、空格）。 */
export function canonical(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * 按答案的标点给输入「补全」连字符 / 撇号：
 * 只要已输入的字母序列是答案字母序列的前缀，就把答案里对应的
 * `-` / `'` 自动带上（bad → bad-t → bad-temperedly）。
 * 这样连字符词、缩写不用手打连接符。
 */
export function formatAnswerInput(raw: string, answer: string): string {
  const typed = canonical(raw)
  if (!typed) return raw
  if (!canonical(answer).startsWith(typed)) return raw
  let count = 0
  for (let i = 0; i < answer.length; i++) {
    if (/[a-z0-9]/i.test(answer[i])) {
      count += 1
      if (count === typed.length) return answer.slice(0, i + 1)
    }
  }
  return raw
}

/**
 * 在 text 里找目标词并按 lemma 归位，返回挖空后的文本与命中的原始词形。
 * 找不到返回 null。短语（含空格）按整段子串匹配。
 */
export function blankWord(text: string, lemma: string): { blanked: string; surface: string } | null {
  if (!text || !lemma) return null
  if (lemma.includes(' ')) {
    const idx = text.toLowerCase().indexOf(lemma.toLowerCase())
    if (idx < 0) return null
    const surface = text.slice(idx, idx + lemma.length)
    return { blanked: `${text.slice(0, idx)}____${text.slice(idx + lemma.length)}`, surface }
  }
  for (const w of wordSpans(text)) {
    if (w.text.length > 1 && lemmaOf(w.text) === lemma) {
      return { blanked: `${text.slice(0, w.start)}____${text.slice(w.end)}`, surface: w.text }
    }
  }
  return null
}

export function baseAccept(it: VocabItem, surface: string): string[] {
  const set = new Set<string>([normalizeAnswer(surface), normalizeAnswer(it.word), it.lemma])
  set.delete('')
  return [...set]
}

/**
 * 两个释义是否「近义/包含」（去标点后相等或互为子串）。
 * 用来剔掉「微调 / 微调，调整」这类会造成多个正确答案的干扰项。
 */
function meaningOverlaps(a: string, b: string): boolean {
  const strip = (s: string) => normalizeAnswer(s).replace(/[，,；;、\s。.!?！？]+/g, '')
  const x = strip(a)
  const y = strip(b)
  if (!x || !y) return false
  return x === y || x.includes(y) || y.includes(x)
}

/** 形近度打分：越小越像（首字母相同、共同前缀长、长度接近）。 */
function similarScore(a: string, b: string): number {
  const al = a.toLowerCase()
  const bl = b.toLowerCase()
  let s = Math.abs(al.length - bl.length)
  if (al[0] === bl[0]) s -= 2
  let p = 0
  while (p < al.length && p < bl.length && al[p] === bl[p]) p += 1
  s -= p
  return s
}

/** 从候选词里挑 n 个与词条形近/音近的干扰项（优先 AI 混淆项，再补生词本）。 */
export function pickDistractors(
  it: VocabItem,
  pool: VocabItem[],
  n: number,
  rnd: () => number = Math.random,
): string[] {
  const word = it.word.trim()
  const seen = new Set<string>([word.toLowerCase()])
  const out: string[] = []
  // 优先用 AI 生成的易混词（跳过与目标近义的，否则选择题有多个答案）
  for (const c of it.confusables ?? []) {
    const w = c.word.trim()
    if (!w || seen.has(w.toLowerCase())) continue
    if (c.meaning && meaningOverlaps(c.meaning, it.meaning ?? '')) continue
    seen.add(w.toLowerCase())
    out.push(w)
    if (out.length >= n) return out
  }
  const cands = shuffleQuiz(
    pool.filter((x) => x.word.trim() && !seen.has(x.word.trim().toLowerCase())),
    rnd,
  )
  cands.sort((a, b) => similarScore(word, a.word) - similarScore(word, b.word))
  for (const c of cands) {
    const w = c.word.trim()
    if (seen.has(w.toLowerCase())) continue
    seen.add(w.toLowerCase())
    out.push(w)
    if (out.length >= n) break
  }
  return out
}

/** 从候选词里挑 n 个中文释义作干扰项（优先 AI 混淆项，再补生词本）。 */
export function pickMeaningDistractors(
  it: VocabItem,
  pool: VocabItem[],
  n: number,
  rnd: () => number = Math.random,
): string[] {
  const seen = new Set<string>([normalizeAnswer(it.meaning ?? '')])
  const out: string[] = []
  // 与目标释义近义 / 与已选干扰项近义 → 不用
  const tooClose = (m: string) => meaningOverlaps(m, it.meaning ?? '') || out.some((o) => meaningOverlaps(m, o))
  for (const c of it.confusables ?? []) {
    const m = (c.meaning ?? '').trim()
    if (!m) continue
    const key = normalizeAnswer(m)
    if (!key || seen.has(key) || tooClose(m)) continue
    seen.add(key)
    out.push(m)
    if (out.length >= n) return out
  }
  for (const c of shuffleQuiz(pool, rnd)) {
    const m = (c.meaning ?? '').trim()
    if (!m) continue
    const key = normalizeAnswer(m)
    if (!key || seen.has(key) || tooClose(m)) continue
    seen.add(key)
    out.push(m)
    if (out.length >= n) break
  }
  return out
}

/** 该词可练的「词块」：用法 + 词组（去空、去重、去掉等于词本身的）。 */
export function chunkList(it: VocabItem): string[] {
  const word = it.word.trim().toLowerCase()
  const out: string[] = []
  for (const c of [...it.usage, ...(it.phrases ?? [])]) {
    const t = c.trim()
    if (!t || t.toLowerCase() === word) continue
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t)
  }
  return out
}

/** 常见介词 / 小品词（做填空干扰项）。 */
export const PARTICLES = [
  'on', 'in', 'at', 'of', 'to', 'for', 'with', 'from', 'about', 'into', 'over',
  'by', 'up', 'out', 'down', 'off', 'away', 'against', 'upon', 'through', 'after', 'under', 'across',
]

/** 把搭配里最后一个介词/小品词挖空（run out of → run out ____）。没有则返回 null。 */
export function blankParticle(collocation: string): { blanked: string; particle: string } | null {
  const spans = wordSpans(collocation)
  for (let i = spans.length - 1; i >= 0; i--) {
    if (PARTICLES.includes(spans[i].text.toLowerCase())) {
      const w = spans[i]
      return { blanked: `${collocation.slice(0, w.start)}____${collocation.slice(w.end)}`, particle: w.text }
    }
  }
  return null
}

/** 语法标记成对题（可数/不可数、及物/不及物、可分级/不可分级）。 */
const MARK_PAIRS: { a: string; b: string; label: string }[] = [
  { a: '可数', b: '不可数', label: '这个名词（此义）可数吗？' },
  { a: '及物', b: '不及物', label: '这个动词（此义）及物吗？（要不要跟宾语）' },
  { a: '可分级', b: '不可分级', label: '这个形容词可分级吗？（能不能用 more/most 比较）' },
]

/** 由语法标记生成一道「判断」题（兼类 / 无标记 → 没有唯一答案，返回 null）。 */
export function markQuestion(it: VocabItem): { label: string; answer: string; options: string[] } | null {
  const marks = it.grammarMarks ?? []
  for (const p of MARK_PAIRS) {
    const hasA = marks.includes(p.a)
    const hasB = marks.includes(p.b)
    if (hasA === hasB) continue
    return { label: p.label, answer: hasA ? p.a : p.b, options: [p.a, p.b] }
  }
  return null
}

/** Fisher–Yates 洗牌（可注入随机源，便于测试）。 */
export function shuffleQuiz<T>(arr: T[], rnd: () => number = Math.random): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
