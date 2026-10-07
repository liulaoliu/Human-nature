import { normalizeAnswer, shuffleQuiz, type ArticleQuizKind, type QuizQuestion } from './quiz'
import { wordSpans } from './wordSelect'
import type { Sentence } from '../types/document'

/**
 * 文章级测验：按句子 / 段落出题，考理解与结构（不写 SRS）。
 *
 * 题型：
 *   - translate   英译中：给英文原句，选正确中文
 *   - translate2  中译英：给中文，选正确英文原句
 *   - functionWord 功能词填空：挖掉介词/冠词/连词，选词填回
 *   - ordering    句子排序：一节的 3 句打乱，选回原文顺序
 *   - grammar     结构/语法：给句子，选它真实用到的语法点（依语言点数据）
 *
 * 纯函数，可注入随机源，便于单测。
 */

const PREPS = [
  'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'into', 'over', 'under',
  'about', 'after', 'before', 'between', 'during', 'against', 'among', 'through',
  'without', 'within', 'across', 'along', 'behind', 'beyond', 'despite', 'except',
  'toward', 'towards', 'upon', 'per', 'via', 'throughout', 'besides',
]
const ARTS = ['a', 'an', 'the']
const CONJS = [
  'and', 'but', 'or', 'nor', 'so', 'yet', 'because', 'although', 'though', 'while',
  'whereas', 'if', 'unless', 'since', 'than', 'whether', 'once', 'until',
]
const FUNC = new Set([...PREPS, ...ARTS, ...CONJS])

export interface ArticleQuizOptions {
  kinds?: ArticleQuizKind[]
  rnd?: () => number
}

/** 从候选里挑 n 个与答案不同的（按归一化去重）。 */
function pickN(answer: string, pool: string[], n: number, rnd: () => number): string[] {
  const seen = new Set([normalizeAnswer(answer)])
  const out: string[] = []
  for (const p of shuffleQuiz(pool, rnd)) {
    const k = normalizeAnswer(p)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(p)
    if (out.length >= n) break
  }
  return out
}

function mcBase(q: Omit<QuizQuestion, 'options' | 'answer' | 'accept'>, answer: string, options: string[], rnd: () => number): QuizQuestion {
  return { ...q, source: 'article', answer, options: shuffleQuiz(options, rnd), accept: [normalizeAnswer(answer)] }
}

const PERMS3 = [
  ['A', 'B', 'C'], ['A', 'C', 'B'], ['B', 'A', 'C'],
  ['B', 'C', 'A'], ['C', 'A', 'B'], ['C', 'B', 'A'],
]

/** 生成文章级题目。 */
export function buildArticleQuestions(sentences: Sentence[], opts: ArticleQuizOptions = {}): QuizQuestion[] {
  const rnd = opts.rnd ?? Math.random
  const kinds = opts.kinds ?? (['translate', 'translate2', 'functionWord', 'ordering', 'grammar'] as ArticleQuizKind[])
  const want = new Set(kinds)
  const out: QuizQuestion[] = []

  const withText = sentences.filter((s) => s.text.trim())
  const withTr = withText.filter((s) => (s.translation ?? '').trim())

  // 英译中 / 中译英
  if (want.has('translate') || want.has('translate2')) {
    const allTr = [...new Set(withTr.map((s) => (s.translation ?? '').trim()))]
    const allText = [...new Set(withText.map((s) => s.text.trim()))]
    for (const s of withTr) {
      const tr = (s.translation ?? '').trim()
      if (want.has('translate')) {
        const dist = pickN(tr, allTr, 3, rnd)
        if (dist.length >= 3) {
          out.push(
            mcBase(
              {
                id: `article:translate:${s.id}`, itemId: s.id, lemma: '', kind: 'translate',
                word: '', prompt: s.text.trim(), meaning: null, partOfSpeech: null, phonetic: null,
                context: s.text.trim(), translation: tr,
              },
              tr,
              [tr, ...dist],
              rnd,
            ),
          )
        }
      }
      if (want.has('translate2')) {
        const en = s.text.trim()
        const dist = pickN(en, allText, 3, rnd)
        if (dist.length >= 3) {
          out.push(
            mcBase(
              {
                id: `article:translate2:${s.id}`, itemId: s.id, lemma: '', kind: 'translate2',
                word: '', prompt: tr, meaning: null, partOfSpeech: null, phonetic: null,
                context: en, translation: tr,
              },
              en,
              [en, ...dist],
              rnd,
            ),
          )
        }
      }
    }
  }

  // 功能词填空
  if (want.has('functionWord')) {
    for (const s of withText) {
      const cands = wordSpans(s.text).filter((w) => FUNC.has(w.text.toLowerCase()))
      if (!cands.length) continue
      const pick = cands[Math.floor(rnd() * cands.length)]
      const lower = pick.text.toLowerCase()
      const cat = ARTS.includes(lower) ? ARTS : CONJS.includes(lower) ? CONJS : PREPS
      const dist = pickN(lower, cat, 3, rnd)
      if (dist.length < 3) continue
      const blanked = `${s.text.slice(0, pick.start)}____${s.text.slice(pick.end)}`
      out.push(
        mcBase(
          {
            id: `article:functionWord:${s.id}:${pick.start}`, itemId: s.id, lemma: '', kind: 'functionWord',
            word: '', prompt: blanked, meaning: null, partOfSpeech: null, phonetic: null,
            context: s.text, translation: (s.translation ?? '').trim() || undefined,
          },
          lower,
          [lower, ...dist],
          rnd,
        ),
      )
    }
  }

  // 句子排序（按段落取前 3 句）
  if (want.has('ordering')) {
    const byPara = new Map<string, Sentence[]>()
    for (const s of withText) {
      const arr = byPara.get(s.paraId)
      if (arr) arr.push(s)
      else byPara.set(s.paraId, [s])
    }
    for (const [paraId, arr] of byPara) {
      if (arr.length < 3) continue
      const three = arr.slice(0, 3)
      // 展示顺序：position -> 原句下标
      const perm = shuffleQuiz([0, 1, 2], rnd)
      const letterOf: Record<number, string> = {}
      const letters = ['A', 'B', 'C']
      perm.forEach((origIdx, pos) => {
        letterOf[origIdx] = letters[pos]
      })
      const presented = perm.map((origIdx, pos) => `${letters[pos]}. ${three[origIdx].text.trim()}`)
      const correct = [0, 1, 2].map((i) => letterOf[i]).join(' ')
      const all = PERMS3.map((p) => p.join(' ')).filter((x) => x !== correct)
      const dist = pickN(correct, all, 3, rnd)
      if (dist.length < 3) continue
      out.push(
        mcBase(
          {
            id: `article:ordering:${paraId}`, itemId: paraId, lemma: '', kind: 'ordering',
            word: '', prompt: `把下面三句排回原文顺序：\n${presented.join('\n')}`,
            meaning: null, partOfSpeech: null, phonetic: null,
            context: [0, 1, 2].map((i) => three[i].text.trim()).join(' '),
          },
          correct,
          [correct, ...dist],
          rnd,
        ),
      )
    }
  }

  // 结构/语法（依语言点数据）
  if (want.has('grammar')) {
    const withGram = withText.filter((s) => (s.language?.grammar ?? '').trim())
    const allGram = [...new Set(withGram.map((s) => (s.language?.grammar ?? '').trim()))]
    for (const s of withGram) {
      const answer = (s.language?.grammar ?? '').trim()
      const dist = pickN(answer, allGram, 3, rnd)
      if (dist.length < 1) continue
      out.push(
        mcBase(
          {
            id: `article:grammar:${s.id}`, itemId: s.id, lemma: '', kind: 'grammar',
            word: '', prompt: s.text.trim(), meaning: null, partOfSpeech: null, phonetic: null,
            context: s.text.trim(),
          },
          answer,
          [answer, ...dist],
          rnd,
        ),
      )
    }
  }

  return out
}
