/**
 * 回译训练（中译英）：给中文，用户写英文，AI 批改，再和原句对照。
 *
 * 两条原则写死在提示词和解析里：
 *   1. **原句是参考，不是唯一答案**：同义表达不扣分，只扣真正的意思/语法/搭配错误；
 *   2. **专名分三档**：中文已给拉丁字母的照常要求；常见专名写成别的实体按「意思」扣；
 *      冷门音译/建筑/组织名的拼写差异不计分（`type: 'properNoun', deduct: false`）。
 *
 * 记录是自包含的（中文题干 + 用户答案 + 原句 + 批改），文章删了也能回看；
 * 解析对 AI 返回的 JSON 严格收窄，坏数据不落库。
 */

export type BackTranslationIssueType = 'grammar' | 'collocation' | 'meaning' | 'properNoun' | 'style'

export interface BackTranslationScore {
  dimension: string
  score: number
  max: number
  comment?: string
}

export interface BackTranslationIssue {
  /** 用户原文里出问题的片段；专名提示可能为空 */
  original: string
  /** 建议写法 */
  suggestion: string
  reason?: string
  type?: BackTranslationIssueType
  /** 是否计入分数。专名的拼写/音译差异通常为 false */
  deduct: boolean
}

export interface BackTranslationFeedback {
  scores: BackTranslationScore[]
  total: number
  max: number
  issues: BackTranslationIssue[]
  polished?: string
  /** 1–2 个同样成立的写法（防止把原句当唯一答案） */
  alternatives: string[]
  summary?: string
}

export interface Closeness {
  exact: boolean
  /** 词级重合度 0–1，仅用于展示，不参与评分 */
  ratio: number
  tier: 'exact' | 'near' | 'fair' | 'loose'
}

export interface BackTranslationRecord {
  /** 合并导入去重用（时间 + 文章 + 句子 + 答案指纹） */
  id: string
  at: string
  articleId: string
  articleTitle?: string
  sentenceId: string
  /** 当时的中文题干 */
  sourceZh: string
  /** 上一句中文，保留代词/指代语境 */
  contextZh?: string
  answer: string
  reference: string
  feedback: BackTranslationFeedback
  /** 和原句的接近程度；只展示，不进总分 */
  closeness: { exact: boolean; ratio: number }
  /** 本机直连批改 / 复制提示词后粘贴 */
  gradedBy?: 'local' | 'manual'
}

const ISSUE_TYPES: ReadonlySet<string> = new Set<BackTranslationIssueType>([
  'grammar',
  'collocation',
  'meaning',
  'properNoun',
  'style',
])

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(asString).filter(Boolean) : []
}

function asNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function stripFence(raw: string): string {
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return (m ? m[1] : raw).trim()
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** 词级归一化：只保留字母/数字词，大小写和弯引号不敏感。 */
function wordsOf(text: string): string[] {
  const normalized = text
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
  return normalized.match(/[\p{L}\p{N}]+(?:'[\p{L}]+)*/gu) ?? []
}

/** 严格到「标点/大小写之外完全一样」才算 exact；差一个词只算 near。 */
function normalizeExact(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/g, '')
    .toLowerCase()
}

function lcsLength(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  let prev = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0)
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1])
    }
    prev = cur
  }
  return prev[b.length]
}

/** 和原句的接近度。只用于「像不像原文」的展示，不参与 AI 评分。 */
export function compareToReference(answer: string, reference: string): Closeness {
  const a = wordsOf(answer)
  const b = wordsOf(reference)
  const exact = normalizeExact(answer) === normalizeExact(reference)
  const ratio = a.length + b.length === 0 ? 1 : (2 * lcsLength(a, b)) / (a.length + b.length)
  const tier: Closeness['tier'] = exact ? 'exact' : ratio >= 0.9 ? 'near' : ratio >= 0.6 ? 'fair' : 'loose'
  return { exact, ratio: Math.round(Math.min(1, Math.max(0, ratio)) * 1000) / 1000, tier }
}

export interface DiffPart {
  kind: 'same' | 'add' | 'del'
  text: string
}

/**
 * 词级对照。以原文为基准：
 *   - `add`：原文有、你的答案没有（漏了/换了词）
 *   - `del`：你的答案有、原文没有（多写/换了词）
 *   - `same`：两边都有
 */
export function diffWords(answer: string, reference: string): DiffPart[] {
  const a = wordsOf(answer)
  const b = wordsOf(reference)
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: DiffPart[] = []
  const push = (kind: DiffPart['kind'], text: string) => {
    const last = out[out.length - 1]
    if (last && last.kind === kind) last.text += ' ' + text
    else out.push({ kind, text })
  }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('same', a[i])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('del', a[i])
      i++
    } else {
      push('add', b[j])
      j++
    }
  }
  while (i < a.length) push('del', a[i++])
  while (j < b.length) push('add', b[j++])
  return out
}

export interface BackTranslationPromptInput {
  sourceZh: string
  reference: string
  contextZh?: string
  articleTitle?: string
}

/** 批改提示词。原文只作参考，专名按三档处理。 */
export function buildBackTranslationPrompt(input: BackTranslationPromptInput): string {
  const sourceZh = input.sourceZh.trim()
  const reference = input.reference.trim()
  return [
    '你是严格的英语回译（中译英）批改老师。学生看到中文题干，写出英文；下面 reference 是文章原句。',
    '',
    '核心原则：',
    '- **原句只是一种参考写法，不是唯一答案。** 学生的英文如果意思完整、语法正确、表达自然，即使和原句不同，也必须给高分；',
    '- 只扣真实存在的错误：漏信息、加信息、时态/逻辑错、语法错、搭配不自然、语域不当；不要因为「不像原句」扣分；',
    '- 不要客套、不要空泛鼓励；每条问题都要指出学生原文里的具体片段，并给可直接替换的写法。',
    '',
    '评分（总分 100）：',
    '- 意思还原 40：信息是否完整、指代/时态/逻辑是否正确；',
    '- 语法 30：时态、主谓一致、冠词、介词、从句结构；',
    '- 用词与搭配 20：搭配是否自然、语域是否合适；',
    '- 连贯简洁 10：不啰嗦、句子顺畅。',
    '',
    '专名（人名/地名/建筑名/组织名）规则，必须按三档处理：',
    '1. 中文题干已经给出拉丁字母或通用缩写（如 Rahman、WHO）：按普通拼写照常要求，拼错可轻微扣分；',
    '2. 常见专名（国家、首都、联合国、欧盟、知名机构/人物）：应写出常见英文名；写成另一个实体按「意思」扣分；同一实体的不同叫法（the US / the United States / America，the UN / the United Nations）不扣；',
    '3. 冷门音译、建筑名、组织名、只在本文出现的人名：中文无法唯一反推英文，**拼写/音译差异不扣分**；只有换成另一个实体才按「意思」扣；',
    '4. 大小写、冠词有无、音译拼法不同，都不算错。',
    '',
    'issues 字段要求：',
    '- type 只能是 grammar / collocation / meaning / properNoun / style；',
    '- 专名的拼写或音译差异：type="properNoun"，deduct=false，在 reason 里说明「不计分」；',
    '- 换成另一个实体：type="meaning"，deduct=true，reason 说明是指代变了，不是拼写；',
    '- 其它问题 deduct=true；没有问题时 issues 给空数组，不要编造。',
    '',
    '另外给出：',
    '- polished：一份完整、自然的改写（保留学生原意，修正所有扣分问题）；',
    '- alternatives：1–2 个同样成立的写法（可以是原句之外的说法）；',
    '- summary：中文 2–3 句，直说最需要改的地方。',
    '',
    input.articleTitle ? `文章：${input.articleTitle}` : '',
    input.contextZh ? `上一句中文（仅供理解指代，不要翻译它）：${input.contextZh}` : '',
    '中文题干：',
    '"""',
    sourceZh,
    '"""',
    '参考原句（不是唯一答案）：',
    '"""',
    reference,
    '"""',
    '',
    '只输出一个 JSON 对象，不要任何其他文字。格式：',
    '{"scores":[{"dimension":"意思还原","score":36,"max":40,"comment":"..."}],"total":86,"max":100,"issues":[{"original":"学生原文片段","suggestion":"建议写法","reason":"...","type":"grammar","deduct":true}],"polished":"...","alternatives":["..."],"summary":"..."}',
  ]
    .filter(Boolean)
    .join('\n')
}

/** 把 AI 返回的 JSON 收窄成反馈；没有 scores 也没有 issues 视为无效。 */
export function normalizeBackTranslationFeedback(value: unknown): BackTranslationFeedback | null {
  if (!isObject(value)) return null
  const scores: BackTranslationScore[] = []
  if (Array.isArray(value.scores)) {
    for (const s of value.scores) {
      if (!isObject(s)) continue
      const dimension = asString(s.dimension)
      if (!dimension) continue
      const score = asNumber(s.score)
      const max = asNumber(s.max)
      if (score < 0 || max < 0) continue
      scores.push({
        dimension,
        score,
        max,
        comment: asString(s.comment) || undefined,
      })
    }
  }

  const issues: BackTranslationIssue[] = []
  if (Array.isArray(value.issues)) {
    for (const it of value.issues) {
      if (!isObject(it)) continue
      const suggestion = asString(it.suggestion)
      if (!suggestion) continue
      const type = ISSUE_TYPES.has(asString(it.type)) ? (asString(it.type) as BackTranslationIssueType) : undefined
      issues.push({
        original: asString(it.original),
        suggestion,
        reason: asString(it.reason) || undefined,
        type,
        // 模型漏给时：专名默认不计分，其它默认计分（不放水）
        deduct: typeof it.deduct === 'boolean' ? it.deduct : type !== 'properNoun',
      })
    }
  }
  if (!scores.length && !issues.length) return null

  // 总分由维度分重算，避免模型给的 total 和 scores 对不上。
  const sumScore = scores.reduce((n, s) => n + s.score, 0)
  const sumMax = scores.reduce((n, s) => n + s.max, 0)
  const total = sumMax > 0 ? Math.round(sumScore * 100) / 100 : asNumber(value.total)
  const max = sumMax > 0 ? Math.round(sumMax * 100) / 100 : asNumber(value.max)

  return {
    scores,
    total,
    max,
    issues,
    polished: asString(value.polished) || undefined,
    alternatives: asStringArray(value.alternatives),
    summary: asString(value.summary) || undefined,
  }
}

/** 解析 AI 原始文本（可能带 Markdown 围栏）。 */
export function parseBackTranslationFeedback(raw: string): BackTranslationFeedback | null {
  const text = stripFence(raw)
  if (!text) return null
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    return null
  }
  return normalizeBackTranslationFeedback(obj)
}

/** 记录 id：同一毫秒重写同一句时也能区分（答案指纹）。 */
export function makeBackTranslationId(at: string, articleId: string, sentenceId: string, answer: string): string {
  let h = 2166136261
  for (const ch of answer) {
    h ^= ch.codePointAt(0) ?? 0
    h = Math.imul(h, 16777619)
  }
  return `${at}|${articleId}|${sentenceId}|${(h >>> 0).toString(36)}`
}

/** 追加一条（新的在前）；同一 id 去重。不按条数截断：这是长期存档。 */
export function addBackTranslationRecord(
  list: BackTranslationRecord[],
  rec: BackTranslationRecord,
): BackTranslationRecord[] {
  if (list.some((r) => r.id === rec.id)) return list
  return [rec, ...list]
}

function normalizeCloseness(raw: unknown, answer: string, reference: string): BackTranslationRecord['closeness'] {
  if (isObject(raw)) {
    const exact = raw.exact === true
    const ratio = Math.min(1, Math.max(0, asNumber(raw.ratio)))
    if (Number.isFinite(ratio)) return { exact, ratio }
  }
  const c = compareToReference(answer, reference)
  return { exact: c.exact, ratio: c.ratio }
}

/** 外部输入（备份 / SQLite 缓存）→ 好记录；坏条目直接丢弃。 */
export function normalizeBackTranslationRecords(raw: unknown): BackTranslationRecord[] {
  if (!Array.isArray(raw)) return []
  const out: BackTranslationRecord[] = []
  for (const it of raw) {
    if (!isObject(it)) continue
    const at = asString(it.at)
    const articleId = asString(it.articleId)
    const sentenceId = asString(it.sentenceId)
    const sourceZh = asString(it.sourceZh)
    const answer = asString(it.answer)
    const reference = asString(it.reference)
    if (!at || !articleId || !sentenceId || !sourceZh || !answer || !reference) continue
    if (Number.isNaN(new Date(at).getTime())) continue
    const feedback = normalizeBackTranslationFeedback(it.feedback)
    if (!feedback) continue
    const id = asString(it.id) || makeBackTranslationId(at, articleId, sentenceId, answer)
    const gradedBy = it.gradedBy === 'local' || it.gradedBy === 'manual' ? it.gradedBy : undefined
    out.push({
      id,
      at,
      articleId,
      articleTitle: asString(it.articleTitle) || undefined,
      sentenceId,
      sourceZh,
      contextZh: asString(it.contextZh) || undefined,
      answer,
      reference,
      feedback,
      closeness: normalizeCloseness(it.closeness, answer, reference),
      gradedBy,
    })
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))
}
