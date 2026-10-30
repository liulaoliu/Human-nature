import { lemmaOf } from './vocab'
import type { VocabItem } from '../types/document'
import {
  baseAccept,
  blankParticle,
  blankWord,
  canonical,
  chunkList,
  markQuestion,
  normalizeAnswer,
  PARTICLES,
  pickDistractors,
  pickMeaningDistractors,
  shuffleQuiz,
} from './quizParts'

// 出题素材拆到 quizParts，公开入口仍是 quiz.ts：调用方与测试不用改 import。
export {
  blankParticle,
  blankWord,
  chunkList,
  formatAnswerInput,
  markQuestion,
  maskAnswer,
  normalizeAnswer,
  pickDistractors,
  pickMeaningDistractors,
  shuffleQuiz,
} from './quizParts'


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
export function buildQuizQuestions(items: VocabItem[], kinds: QuizKind[]): QuizQuestion[] {
  const out: QuizQuestion[] = []
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
 */
export function makeDictationQuestion(it: VocabItem, sentenceText: string): QuizQuestion | null {
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

