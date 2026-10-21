import { lemmaOf } from './vocab'
import { wordSpans } from './wordSelect'
import type { VocabItem } from '../types/document'

/**
 * 考试（检验掌握效果）的出题与判分逻辑。纯函数，不碰界面，方便单测。
 *
 * 题型：
 *   - spell 拼写：给中文释义，拼出英文单词（最基础）
 *   - cloze 例句填空：把例句 / 来源句里的目标词挖空，要求填回来（考语境）
 *   - usage 搭配填空：把「用法/搭配」里的目标词挖空（考使用方式）
 *   - listen 听力填空：朗读句子、隐藏文本，听音填词
 *   - choice 词形辨析：给释义，从形近/音近选项里选词（快）
 *
 * 判分对大小写、首尾标点、常见词形变化宽容。
 */

/** 词级题型（按生词出题，现有考试）。 */
export type VocabQuizKind =
  | 'spell'
  | 'cloze'
  | 'usage'
  | 'listen'
  | 'choice'
  | 'meaning'
  | 'ear'
  // 精读专用（更细、更针对）：
  | 'define' // 英英释义 → 写单词
  | 'defineChoice' // 英英释义 → 选单词
  | 'collocation' // 搭配默写：写出一条该词的搭配/词组
  | 'prep' // 介词/小品词填空：搭配里挖掉 on/in/to…，选一个
  | 'mark' // 语法标记判断：可数/不可数、及物/不及物、可分级/不可分级
  | 'idiom' // 习语填空：习语里挖掉目标词，写回来
/** 文章级题型（按句子/段落出题，考理解与结构）。 */
export type ArticleQuizKind =
  | 'translate'
  | 'translate2'
  | 'functionWord'
  | 'ordering'
  | 'grammar'
  | 'phraseBlank' // 词组/习语填空：把句中的词组/习语挖空，选回去
export type QuizKind = VocabQuizKind | ArticleQuizKind

export const VOCAB_KINDS: VocabQuizKind[] = [
  'spell',
  'cloze',
  'usage',
  'listen',
  'choice',
  'meaning',
  'ear',
  'define',
  'defineChoice',
  'collocation',
  'prep',
  'mark',
  'idiom',
]
export const ARTICLE_KINDS: ArticleQuizKind[] = ['translate', 'translate2', 'functionWord', 'ordering', 'grammar', 'phraseBlank']

export const QUIZ_KIND_LABEL: Record<QuizKind, string> = {
  spell: '拼写',
  cloze: '例句填空',
  usage: '搭配填空',
  listen: '听力填空',
  choice: '词形辨析',
  meaning: '看词选义',
  ear: '听音拼词',
  define: '英英释义（写）',
  defineChoice: '英英释义（选）',
  collocation: '搭配默写',
  prep: '介词填空',
  mark: '语法标记',
  idiom: '习语填空',
  translate: '英译中',
  translate2: '中译英',
  functionWord: '功能词填空',
  ordering: '句子排序',
  grammar: '结构 / 语法',
  phraseBlank: '词组/习语填空',
}

const ALL_KINDS: QuizKind[] = [...VOCAB_KINDS, ...ARTICLE_KINDS]

export function isQuizKind(v: unknown): v is QuizKind {
  return typeof v === 'string' && (ALL_KINDS as string[]).includes(v)
}

/** 是不是「文章级」题型（英译中 / 排序 / 结构语法…）。词级考试要把它筛掉。 */
export function isArticleKind(k: QuizKind): k is ArticleQuizKind {
  return (ARTICLE_KINDS as readonly string[]).includes(k)
}

export interface QuizQuestion {
  /** 题目唯一 id（词条 + 题型） */
  id: string
  itemId: string
  lemma: string
  kind: QuizKind
  /** 来源：词级考试 / 文章级测验（文章题不写 SRS）。 */
  source?: 'vocab' | 'article'
  /** 目标词（显示形式） */
  word: string
  /** 题干：拼写=释义；填空=挖空后的句子 / 搭配 */
  prompt: string
  meaning: string | null
  partOfSpeech: string | null
  phonetic: string | null
  /** 未挖空的原文（答完后展示完整语境） */
  context?: string
  /** 例句中文翻译（若来源例句带） */
  translation?: string
  /** 听力填空：要朗读的完整句子 */
  audioText?: string
  /** 词形辨析：选项（含正确答案） */
  options?: string[]
  /** 标准答案（原句里出现的词形） */
  answer: string
  /** 可接受答案（归一化后） */
  accept: string[]
}

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
function canonical(s: string): string {
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

function baseAccept(it: VocabItem, surface: string): string[] {
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
function similarScore(a: string, b: string): number {  const al = a.toLowerCase()
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
const PARTICLES = [
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

/** 由词条 + 题型出一道题；数据不够（无释义 / 无句子）返回 null。 */
export function makeQuestion(it: VocabItem, kind: QuizKind, pool: VocabItem[] = []): QuizQuestion | null {
  // 文章级题型要整篇 doc（句子/段落），这里（词级）出不了
  if ((ARTICLE_KINDS as readonly string[]).includes(kind)) return null
  const word = it.word.trim()
  if (!word) return null

  if (kind === 'spell') {
    if (!it.meaning) return null
    return {
      id: `${it.id}:spell`,
      itemId: it.id,
      lemma: it.lemma,
      kind,
      word,
      prompt: it.meaning,
      meaning: it.meaning,
      partOfSpeech: it.partOfSpeech,
      phonetic: it.phonetic,
      answer: word,
      accept: baseAccept(it, word),
    }
  }

  if (kind === 'ear') {
    // 听音拼词：只放音、不给任何文字提示
    return {
      id: `${it.id}:ear`,
      itemId: it.id,
      lemma: it.lemma,
      kind,
      word,
      prompt: '',
      meaning: null,
      partOfSpeech: null,
      phonetic: it.phonetic,
      audioText: word,
      answer: word,
      accept: baseAccept(it, word),
    }
  }

  if (kind === 'choice') {
    if (!it.meaning) return null
    const distractors = pickDistractors(it, pool, 3)
    if (distractors.length < 1) return null
    return {
      id: `${it.id}:choice`,
      itemId: it.id,
      lemma: it.lemma,
      kind,
      word,
      prompt: it.meaning,
      meaning: it.meaning,
      partOfSpeech: it.partOfSpeech,
      phonetic: it.phonetic,
      options: shuffleQuiz([word, ...distractors]),
      answer: word,
      accept: baseAccept(it, word),
    }
  }

  if (kind === 'meaning') {
    if (!it.meaning) return null
    const distractors = pickMeaningDistractors(it, pool, 3)
    if (distractors.length < 1) return null
    return {
      id: `${it.id}:meaning`,
      itemId: it.id,
      lemma: it.lemma,
      kind,
      word,
      // 题干是英文单词，选项是中文释义
      prompt: word,
      meaning: it.meaning,
      partOfSpeech: it.partOfSpeech,
      phonetic: it.phonetic,
      options: shuffleQuiz([it.meaning, ...distractors]),
      answer: it.meaning,
      accept: [normalizeAnswer(it.meaning)],
    }
  }

  if (kind === 'cloze' || kind === 'listen') {
    const contexts = [
      ...it.examples.map((e) => ({ text: e.text, translation: e.translation })),
      { text: it.source?.sentenceText ?? '', translation: undefined as string | undefined },
    ].filter((c) => c.text.trim() && c.text.trim().toLowerCase() !== word.toLowerCase())
    for (const ctx of contexts) {
      const b = blankWord(ctx.text, it.lemma)
      if (!b) continue
      return {
        id: `${it.id}:${kind}`,
        itemId: it.id,
        lemma: it.lemma,
        kind,
        word,
        // 听力填空不显示句子（靠听），其余显示挖空句
        prompt: kind === 'listen' ? '' : b.blanked,
        meaning: it.meaning,
        partOfSpeech: it.partOfSpeech,
        phonetic: it.phonetic,
        context: ctx.text,
        translation: ctx.translation,
        audioText: kind === 'listen' ? ctx.text : undefined,
        answer: b.surface,
        accept: baseAccept(it, b.surface),
      }
    }
    return null
  }

  // 英英释义 → 写单词（考「用英文理解英文」）
  if (kind === 'define') {
    const def = (it.definition ?? '').trim()
    if (!def) return null
    return {
      id: `${it.id}:define`,
      itemId: it.id,
      lemma: it.lemma,
      kind,
      word,
      prompt: def,
      meaning: it.meaning,
      partOfSpeech: it.partOfSpeech,
      phonetic: it.phonetic,
      answer: word,
      accept: baseAccept(it, word),
    }
  }

  // 英英释义 → 选单词（同上，选择题版）
  if (kind === 'defineChoice') {
    const def = (it.definition ?? '').trim()
    if (!def) return null
    const distractors = pickDistractors(it, pool, 3)
    if (distractors.length < 1) return null
    return {
      id: `${it.id}:defineChoice`,
      itemId: it.id,
      lemma: it.lemma,
      kind,
      word,
      prompt: def,
      meaning: it.meaning,
      partOfSpeech: it.partOfSpeech,
      phonetic: it.phonetic,
      options: shuffleQuiz([word, ...distractors]),
      answer: word,
      accept: baseAccept(it, word),
    }
  }

  // 搭配默写：给单词 + 中文，写出一条它的搭配 / 词组
  if (kind === 'collocation') {
    const chunks = chunkList(it)
    if (!chunks.length) return null
    const answer = chunks[0]
    return {
      id: `${it.id}:collocation`,
      itemId: it.id,
      lemma: it.lemma,
      kind,
      word,
      prompt: word,
      meaning: it.meaning,
      partOfSpeech: it.partOfSpeech,
      phonetic: it.phonetic,
      context: chunks.join('；'),
      answer,
      accept: [...new Set(chunks.map((c) => normalizeAnswer(c)))],
    }
  }

  // 介词 / 小品词填空：从搭配里挖掉 on/in/to…，选一个
  if (kind === 'prep') {
    for (const c of chunkList(it)) {
      const b = blankParticle(c)
      if (!b) continue
      const answer = b.particle.toLowerCase()
      const others = shuffleQuiz(PARTICLES.filter((p) => p !== answer)).slice(0, 3)
      return {
        id: `${it.id}:prep`,
        itemId: it.id,
        lemma: it.lemma,
        kind,
        word,
        prompt: b.blanked,
        meaning: it.meaning,
        partOfSpeech: it.partOfSpeech,
        phonetic: it.phonetic,
        context: c,
        options: shuffleQuiz([answer, ...others]),
        answer,
        accept: [normalizeAnswer(answer)],
      }
    }
    return null
  }

  // 语法标记判断：可数/不可数、及物/不及物、可分级/不可分级
  if (kind === 'mark') {
    const m = markQuestion(it)
    if (!m) return null
    return {
      id: `${it.id}:mark`,
      itemId: it.id,
      lemma: it.lemma,
      kind,
      word,
      prompt: m.label,
      meaning: it.meaning,
      partOfSpeech: it.partOfSpeech,
      phonetic: it.phonetic,
      context: `${word}${it.meaning ? ' — ' + it.meaning : ''}`,
      options: shuffleQuiz(m.options),
      answer: m.answer,
      accept: [normalizeAnswer(m.answer)],
    }
  }

  // 习语填空：习语里挖掉目标词
  if (kind === 'idiom') {
    for (const s of it.idioms ?? []) {
      const b = blankWord(s, it.lemma)
      if (!b) continue
      return {
        id: `${it.id}:idiom`,
        itemId: it.id,
        lemma: it.lemma,
        kind,
        word,
        prompt: b.blanked,
        meaning: it.meaning,
        partOfSpeech: it.partOfSpeech,
        phonetic: it.phonetic,
        context: s,
        answer: b.surface,
        accept: baseAccept(it, b.surface),
      }
    }
    return null
  }

  // usage
  for (const u of it.usage) {
    const b = blankWord(u, it.lemma)
    if (!b) continue
    return {
      id: `${it.id}:usage`,
      itemId: it.id,
      lemma: it.lemma,
      kind,
      word,
      prompt: b.blanked,
      meaning: it.meaning,
      partOfSpeech: it.partOfSpeech,
      phonetic: it.phonetic,
      context: u,
      answer: b.surface,
      accept: baseAccept(it, b.surface),
    }
  }
  return null
}

/** 根据选中的题型，为一组词条出题（每个词条每种题型最多一题）。 */
export function buildQuizQuestions(items: VocabItem[], kinds: QuizKind[]): QuizQuestion[] {  const out: QuizQuestion[] = []
  for (const it of items) {
    for (const kind of kinds) {
      const q = makeQuestion(it, kind, items)
      if (q) out.push(q)
    }
  }
  return out
}

/**
 * 「大概能出多少题」的**廉价**计数：不生成干扰项 / 例句，只判断词条是否具备条件。
 * 用于设置面板提示与统计，避免 O(N²) 的 buildQuizQuestions。
 * （默认「每词一题」模式下，约等于可选词条数。）
 */
export function countQuestions(items: VocabItem[], kinds: QuizKind[]): number {
  const wantEar = kinds.includes('ear')
  const wantMeaningKinds = kinds.includes('spell') || kinds.includes('choice') || kinds.includes('meaning')
  const wantCtx = kinds.includes('cloze') || kinds.includes('listen')
  const wantUsage = kinds.includes('usage')
  const wantDefine = kinds.includes('define') || kinds.includes('defineChoice')
  const wantChunk = kinds.includes('collocation') || kinds.includes('prep')
  const wantMark = kinds.includes('mark')
  const wantIdiom = kinds.includes('idiom')
  let n = 0
  for (const it of items) {
    if (!it.word.trim()) continue
    const hasMeaning = !!it.meaning
    const hasCtx = it.examples.some((e) => e.text.trim()) || !!it.source?.sentenceText
    const hasUsage = it.usage.length > 0
    const hasDefine = !!it.definition
    const hasChunk = chunkList(it).length > 0
    const hasMark = markQuestion(it) !== null
    const hasIdiom = (it.idioms ?? []).some((s) => blankWord(s, it.lemma) !== null)
    if (
      wantEar ||
      (wantMeaningKinds && hasMeaning) ||
      (wantCtx && hasCtx) ||
      (wantUsage && hasUsage) ||
      (wantDefine && hasDefine) ||
      (wantChunk && hasChunk) ||
      (wantMark && hasMark) ||
      (wantIdiom && hasIdiom)
    ) {
      n += 1
    }
  }
  return n
}

/**
 * 听写专用题：用给定句子（按原文顺序）做听力填空。
 * 与 makeQuestion('listen') 不同，这里强制用传入的句子，保证听写顺序 = 文章顺序。
 */export function makeDictationQuestion(it: VocabItem, sentenceText: string): QuizQuestion | null {
  const word = it.word.trim()
  if (!word || !sentenceText.trim()) return null
  const b = blankWord(sentenceText, it.lemma)
  if (!b) return null
  return {
    id: `${it.id}:dictation`,
    itemId: it.id,
    lemma: it.lemma,
    kind: 'listen',
    word,
    prompt: '',
    meaning: it.meaning,
    partOfSpeech: it.partOfSpeech,
    phonetic: it.phonetic,
    context: sentenceText,
    audioText: sentenceText,
    answer: b.surface,
    accept: baseAccept(it, b.surface),
  }
}

/** 这些题型考的是「能不能拼对」，不能用词形还原兜底（ran ≠ run）。 */
const STRICT_SPELLING: ReadonlySet<QuizKind> = new Set(['spell', 'ear', 'define'])

/**
 * 判分：归一化后精确命中，或词形还原一致（run / running），
 * 且忽略连字符 / 撇号 / 空格（bad-temperedly = badtemperedly）。
 *
 * 拼写题例外：只认答案本身的拼写，不把 ran / runs 当成 run —— 否则
 * 「拼写错」永远触发不了「判为不认识」。
 */
export function isCorrect(q: QuizQuestion, input: string): boolean {
  const n = normalizeAnswer(input)
  if (!n) return false
  if (q.accept.includes(n)) return true
  const c = canonical(n)
  if (c && q.accept.some((a) => canonical(a) === c)) return true
  if (STRICT_SPELLING.has(q.kind)) return false
  // 词形兜底（run / running）只在「标准答案本身就是该词」时生效；
  // 否则搭配默写写个光杆单词也算对。
  const answerIsWord = lemmaOf(q.answer) === q.lemma
  if (answerIsWord && lemmaOf(n) === q.lemma) return true
  if (answerIsWord && c && canonical(q.lemma) === c) return true
  return false
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
