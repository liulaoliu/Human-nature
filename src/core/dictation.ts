/**
 * 听写对比：把你打的句子和标准句子逐词比对，标出**漏写**和**多写**。
 *
 * 纯函数，不碰 DOM，方便单测。用 LCS（最长公共子序列）做词级 diff：
 *   - same：两边的词一致（比大小写、标点宽松）
 *   - del ：标准句里有、你没写（漏写 / 拼错后少了正确词）
 *   - ins ：你没对、多写的词
 *
 * 目标不是完美对齐，而是让「哪里错了」一眼可见。
 */

export type DiffType = 'same' | 'del' | 'ins'

export interface DiffToken {
  type: DiffType
  text: string
}

/** 按空白切词（保留词形，含标点）。 */
export function wordTokens(s: string): string[] {
  return s
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

/** 比较用的归一化：小写、去标点（撇号保留）。 */
function norm(w: string): string {
  return w
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9']/g, '')
}

export interface DiffResult {
  tokens: DiffToken[]
  /** 逐词完全一致 */
  correct: boolean
  /** 漏写（标准句里的词） */
  missed: string[]
  /** 多写（你写多的词） */
  extra: string[]
}

/** 词级 diff。ref = 标准句，got = 你写的。 */
export function diffWords(ref: string, got: string): DiffResult {
  const a = wordTokens(ref)
  const b = wordTokens(got)
  const na = a.map(norm)
  const nb = b.map(norm)
  const n = a.length
  const m = b.length

  // LCS 长度
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = na[i] === nb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const tokens: DiffToken[] = []
  const missed: string[] = []
  const extra: string[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (na[i] === nb[j]) {
      tokens.push({ type: 'same', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      tokens.push({ type: 'del', text: a[i] })
      missed.push(a[i])
      i++
    } else {
      tokens.push({ type: 'ins', text: b[j] })
      extra.push(b[j])
      j++
    }
  }
  while (i < n) {
    tokens.push({ type: 'del', text: a[i] })
    missed.push(a[i])
    i++
  }
  while (j < m) {
    tokens.push({ type: 'ins', text: b[j] })
    extra.push(b[j])
    j++
  }

  const correct = missed.length === 0 && extra.length === 0
  return { tokens, correct, missed, extra }
}

/** 听写错词：漏写的标准词，去重（供加入待选 / 错词本）。 */
export function dictationWrongWords(result: DiffResult): string[] {
  const out: string[] = []
  for (const w of result.missed) {
    const key = norm(w)
    if (key && !out.some((x) => norm(x) === key)) out.push(w)
  }
  return out
}
