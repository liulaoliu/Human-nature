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

export type QuizKind = 'spell' | 'cloze' | 'usage' | 'listen' | 'choice'

export const QUIZ_KIND_LABEL: Record<QuizKind, string> = {
  spell: '拼写',
  cloze: '例句填空',
  usage: '搭配填空',
  listen: '听力填空',
  choice: '词形辨析',
}

const ALL_KINDS: QuizKind[] = ['spell', 'cloze', 'usage', 'listen', 'choice']

export function isQuizKind(v: unknown): v is QuizKind {
  return typeof v === 'string' && (ALL_KINDS as string[]).includes(v)
}

export interface QuizQuestion {
  /** 题目唯一 id（词条 + 题型） */
  id: string
  itemId: string
  lemma: string
  kind: QuizKind
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

/** 从候选词里挑 n 个与 word 形近/音近的干扰项（去重、排除同 lemma）。 */
export function pickDistractors(
  word: string,
  pool: VocabItem[],
  n: number,
  rnd: () => number = Math.random,
): string[] {
  const seen = new Set<string>([word.toLowerCase()])
  const cands = shuffleQuiz(
    pool.filter((x) => x.word.trim() && !seen.has(x.word.trim().toLowerCase())),
    rnd,
  )
  cands.sort((a, b) => similarScore(word, a.word) - similarScore(word, b.word))
  const out: string[] = []
  for (const c of cands) {
    const w = c.word.trim()
    if (seen.has(w.toLowerCase())) continue
    seen.add(w.toLowerCase())
    out.push(w)
    if (out.length >= n) break
  }
  return out
}

/** 由词条 + 题型出一道题；数据不够（无释义 / 无句子）返回 null。 */
export function makeQuestion(it: VocabItem, kind: QuizKind, pool: VocabItem[] = []): QuizQuestion | null {
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

  if (kind === 'choice') {
    if (!it.meaning) return null
    const distractors = pickDistractors(word, pool, 3)
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

/**
 * 判分：归一化后精确命中，或词形还原一致（run / running），
 * 且忽略连字符 / 撇号 / 空格（bad-temperedly = badtemperedly）。
 */
export function isCorrect(q: QuizQuestion, input: string): boolean {
  const n = normalizeAnswer(input)
  if (!n) return false
  if (q.accept.includes(n)) return true
  if (lemmaOf(n) === q.lemma) return true
  const c = canonical(n)
  if (!c) return false
  if (q.accept.some((a) => canonical(a) === c)) return true
  return canonical(q.lemma) === c
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
