import { lemmaOf } from './vocab'
import { wordSpans } from './wordSelect'
import type { VocabItem } from '../types/document'

/**
 * 考试（检验掌握效果）的出题与判分逻辑。纯函数，不碰界面，方便单测。
 *
 * 三种题型：
 *   - spell 拼写：给中文释义，拼出英文单词（最基础）
 *   - cloze 例句填空：把例句 / 来源句里的目标词挖空，要求填回来（考语境）
 *   - usage 搭配填空：把「用法/搭配」里的目标词挖空（考使用方式）
 *
 * 判分对大小写、首尾标点、常见词形变化宽容。
 */

export type QuizKind = 'spell' | 'cloze' | 'usage'

export const QUIZ_KIND_LABEL: Record<QuizKind, string> = {
  spell: '拼写',
  cloze: '例句填空',
  usage: '搭配填空',
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

/** 由词条 + 题型出一道题；数据不够（无释义 / 无句子）返回 null。 */
export function makeQuestion(it: VocabItem, kind: QuizKind): QuizQuestion | null {
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

  if (kind === 'cloze') {
    const contexts = [
      ...it.examples.map((e) => ({ text: e.text, translation: e.translation })),
      { text: it.source?.sentenceText ?? '', translation: undefined as string | undefined },
    ].filter((c) => c.text.trim() && c.text.trim().toLowerCase() !== word.toLowerCase())
    for (const ctx of contexts) {
      const b = blankWord(ctx.text, it.lemma)
      if (!b) continue
      return {
        id: `${it.id}:cloze`,
        itemId: it.id,
        lemma: it.lemma,
        kind,
        word,
        prompt: b.blanked,
        meaning: it.meaning,
        partOfSpeech: it.partOfSpeech,
        phonetic: it.phonetic,
        context: ctx.text,
        translation: ctx.translation,
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
      const q = makeQuestion(it, kind)
      if (q) out.push(q)
    }
  }
  return out
}

/** 判分：精确（归一化）命中，或词形还原一致（run / running 视为对）。 */
export function isCorrect(q: QuizQuestion, input: string): boolean {
  const n = normalizeAnswer(input)
  if (!n) return false
  if (q.accept.includes(n)) return true
  return lemmaOf(n) === q.lemma
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
