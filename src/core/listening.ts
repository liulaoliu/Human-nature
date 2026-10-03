/**
 * 听力理解题：AI 出题（严格 JSON）+ 本地判分。
 *
 * 流程：把文章交给 AI → 生成带**标准答案和解析**的题 → 存起来 → App 渲染题干让用户作答
 * → 本地判分（不用第二次问 AI）→ 显示正确答案与解析。
 *
 * 提示词强调「严格」：题目必须能从原文找到依据、单选只有一个正确答案、
 * 填空答案必须是原文里的词、必须给解析。解析层对不合格的题**直接丢弃**，不放水。
 */

export type ListeningQType = 'mcq' | 'gap' | 'short'

export interface ListeningQuestion {
  id: string
  type: ListeningQType
  /** 题干；gap 题里用 ____ 表示空 */
  stem: string
  /** mcq 的选项（≥2） */
  options?: string[]
  /** 标准答案（mcq = 选项原文；gap/short = 文本） */
  answer: string
  /** 另外可接受的答案 */
  accept?: string[]
  /** 解析：为什么是这个答案，在原文哪里 */
  explanation?: string
}

export interface ListeningQuiz {
  title?: string
  questions: ListeningQuestion[]
}

/**
 * 出题提示词。要求 AI 只输出 JSON，且题目严格贴合原文。
 */
export function buildListeningQuizPrompt(text: string, opts: { count?: number } = {}): string {
  const count = opts.count && opts.count > 0 ? opts.count : 8
  return [
    '你是英语听力命题老师。请根据下面这篇文章，仿照雅思听力（IELTS Listening）出题。',
    `共出 ${count} 道题，难度贴近雅思 6 分。`,
    '',
    '硬性要求（必须严格遵守）：',
    '- 每道题的答案都必须能在原文里找到依据，不能靠常识或猜测；',
    '- 题型只能从下列三种里选：',
    '  - mcq：单选，给 3–4 个选项，**有且只有一个**正确选项，干扰项要合理但明确错误；',
    '  - gap：句子填空，题干里用 ____ 表示空，答案必须是原文中出现的**一个词或短语**（照抄原文，不改写）；',
    '  - short：简答，答案简短（一个词到一句话），同样以原文为准；',
    '- 每道题必须给 explanation：用一两句话说明答案依据，并引用原文关键片段；',
    '- 不要出需要听音频才能判断、但看文本无法确定答案的题；不要重复考点。',
    '',
    '只输出一个 JSON 对象，不要解释、不要 Markdown 代码块以外的任何文字。格式：',
    '{"questions":[{"id":"q1","type":"mcq","stem":"题干","options":["A","B","C"],"answer":"正确选项原文","explanation":"依据"},{"id":"q2","type":"gap","stem":"The report says ____ rose.","answer":"prices","accept":["the prices"],"explanation":"原文第 3 段"}]}',
    '',
    '文章：',
    '"""',
    text.trim(),
    '"""',
  ].join('\n')
}

/** 去掉 ```json ... ``` 代码栅欄。 */
function stripFence(raw: string): string {
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return (m ? m[1] : raw).trim()
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function normalizeType(v: unknown): ListeningQType | null {
  const t = asString(v).toLowerCase()
  if (t === 'mcq' || t === 'choice' || t === 'multiple_choice') return 'mcq'
  if (t === 'gap' || t === 'blank' || t === 'completion') return 'gap'
  if (t === 'short' || t === 'short_answer') return 'short'
  return null
}

/**
 * 解析并**严格校验** AI 返回的题目；不合格的整题丢弃。
 * 返回可用的题；没有可用题时 questions 为空。
 */
export function parseListeningQuiz(raw: string): ListeningQuiz {
  const text = stripFence(raw)
  if (!text) return { questions: [] }
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    return { questions: [] }
  }
  const list = Array.isArray(obj)
    ? obj
    : obj && typeof obj === 'object' && Array.isArray((obj as { questions?: unknown }).questions)
      ? (obj as { questions: unknown[] }).questions
      : []
  const questions: ListeningQuestion[] = []
  let i = 0
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const type = normalizeType(o.type)
    const stem = asString(o.stem)
    const answer = asString(o.answer)
    if (!type || !stem || !answer) continue
    const options = Array.isArray(o.options) ? o.options.map(asString).filter(Boolean) : undefined
    if (type === 'mcq') {
      if (!options || options.length < 2) continue
      // 正确答案必须是其中一个选项，否则丢弃
      if (!options.includes(answer)) continue
    }
    i += 1
    const accept = Array.isArray(o.accept) ? o.accept.map(asString).filter(Boolean) : undefined
    questions.push({
      id: asString(o.id) || `q${i}`,
      type,
      stem,
      ...(type === 'mcq' ? { options } : {}),
      answer,
      ...(accept && accept.length ? { accept } : {}),
      explanation: asString(o.explanation) || undefined,
    })
  }
  const title = obj && typeof obj === 'object' ? asString((obj as { title?: unknown }).title) : ''
  return { ...(title ? { title } : {}), questions }
}

/** 判分用的归一化：小写、去首尾标点、压缩空白。 */
function normAnswer(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/^["'“”‘’().\[\]]+/, '')
    .replace(/["'“”‘’().\[\]]+$/, '')
    .replace(/\s+/g, ' ')
}

/** 判断一道题的作答是否正确（strict：mcq 必须完全一致；文本题忽略大小写/标点）。 */
export function isListeningCorrect(q: ListeningQuestion, input: string): boolean {
  const got = normAnswer(input)
  if (!got) return false
  if (q.type === 'mcq') return input.trim() === q.answer.trim() || got === normAnswer(q.answer)
  const accepted = [q.answer, ...(q.accept ?? [])].map(normAnswer).filter(Boolean)
  return accepted.includes(got)
}

export interface ListeningResult {
  total: number
  correct: number
  score: number
  /** 每题对错，按题序 */
  per: { id: string; correct: boolean }[]
}

/** 本地判分。answers: questionId → 用户作答。 */
export function gradeListening(
  questions: ListeningQuestion[],
  answers: Record<string, string>,
): ListeningResult {
  const per = questions.map((q) => ({ id: q.id, correct: isListeningCorrect(q, answers[q.id] ?? '') }))
  const correct = per.filter((p) => p.correct).length
  const total = questions.length
  return { total, correct, score: total ? correct / total : 0, per }
}
