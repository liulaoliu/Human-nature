import type { MutableRefObject } from 'react'
import {
  buildAutoVocabPrompt,
  buildBatchLookupPrompt,
  buildConfusablePrompt,
  buildLemmaPrompt,
  buildPosPrompt,
  buildPrompt,
  buildTranslateAllPrompt,
  type AnalysisTask,
  type VocabLevel,
} from '../../core/analyzer'
import { dedupeLibrary, markWord, relemmaLibrary } from '../../core/vocab'
import { buildGoldenPrompt } from '../../core/goldenAi'
import { buildLanguagePrompt } from '../../core/language'
import { buildMissingPrompt, type MissingTask } from '../missingPrompts'
import type { Sentence, VocabItem, VocabLibrary } from '../../types/document'
import type { BatchItemLike } from '../batchItem'

/** 复制提示词时会用到的任务键。 */
export type AiTaskKey =
  | AnalysisTask
  | 'confusable'
  | 'example'
  | 'phrase'
  | 'lemma'
  | 'pos'
  | 'grammar_mark'
  | 'listening'
  | 'language'
  | 'golden'
  | 'imitation'
  | 'feedback'

export interface UseAiTasksParams {
  exact: string
  useExact: boolean
  sentence: Sentence | null
  visibleBatch: BatchItemLike[]
  library: VocabLibrary
  persist: (library: VocabLibrary) => void
  articleIdentity: string
  articleTitle: string
  articleKey: string | null
  doc: { sentences: Sentence[] } | null
  vocabLevel: VocabLevel
  confusableBatch: VocabItem[]
  confusableTodo: VocabItem[]
  lemmaCandidates: VocabItem[]
  posCandidates: VocabItem[]
  flash: (message: string) => void
  setLastTask: (task: AiTaskKey) => void
  setBatch: (updater: [] | ((prev: BatchItemLike[]) => BatchItemLike[])) => void
  askedWordsRef: MutableRefObject<string[]>
  askedIdsRef: MutableRefObject<string[]>
  /** 上次请求所属文章（金句课粘回时校验，防切篇写错）。 */
  askedArticleKeyRef?: MutableRefObject<string | null>
  /** 上次回执里缺失的词（有值才能「一键复制未返回的」） */
  pasteMissing: { task: MissingTask; words: string[] } | null
}

/**
 * 各类「复制提示词给 AI」的动作：选区任务、待选批量查词、补音标、全文翻译、自动标词、
 * 混淆项 / 原形 / -ing-ed，以及去重整理。只负责拼提示词 + 剪贴板 + 记「问过哪些词/句」。
 */
export function useAiTasks({
  exact,
  useExact,
  sentence,
  visibleBatch,
  library,
  persist,
  articleIdentity,
  articleTitle,
  articleKey,
  doc,
  vocabLevel,
  confusableBatch,
  confusableTodo,
  lemmaCandidates,
  posCandidates,
  flash,
  setLastTask,
  setBatch,
  askedWordsRef,
  askedIdsRef,
  askedArticleKeyRef,
  pasteMissing,
}: UseAiTasksParams) {
  const copy = async (prompt: string, okMsg: string) => {
    try {
      await navigator.clipboard.writeText(prompt)
      flash(okMsg)
    } catch {
      flash('复制失败：浏览器需要 localhost 或 https')
    }
  }

  /** 语言点分析：把全文句子交给 AI 找语法 / 习语 / 用法。 */
  const copyLanguagePrompt = async () => {
    if (!doc || !doc.sentences.length) {
      flash('先打开一篇文章')
      return
    }
    setLastTask('language')
    askedWordsRef.current = []
    askedIdsRef.current = doc.sentences.map((s) => s.id)
    await copy(
      buildLanguagePrompt(doc.sentences.map((s) => ({ id: s.id, text: s.text }))),
      '已复制语言点分析提示词；把 AI 的 JSON 粘回「应用结果」',
    )
  }

  /** D老师小课堂：复制金句课提示词（模块里手动重跑用）。 */
  const copyGoldenPrompt = async () => {
    if (!doc || !doc.sentences.length) {
      flash('先打开一篇文章')
      return
    }
    setLastTask('golden')
    askedWordsRef.current = []
    askedIdsRef.current = doc.sentences.map((s) => s.id)
    if (askedArticleKeyRef) askedArticleKeyRef.current = articleKey
    await copy(
      buildGoldenPrompt({
        sentences: doc.sentences.map((s) => ({
          id: s.id,
          text: s.text,
          ...(s.translation ? { translation: s.translation } : {}),
          paraId: s.paraId,
        })),
      }),
      '已复制 D老师小课堂提示词；把 AI 的 JSON 粘回「应用结果」',
    )
  }

  /** 把上次未返回的词重新组成提示词，一键复制重试。 */
  const copyMissingAgain = async () => {
    if (!pasteMissing || !pasteMissing.words.length) return
    const { task, words } = pasteMissing
    askedWordsRef.current = words
    askedIdsRef.current = []
    setLastTask(task)
    await copy(
      buildMissingPrompt(task, words, library.items),
      `已复制缺失的 ${words.length} 个词，去 AI 后再贴回`,
    )
  }

  /** 选区任务（翻译/查词/语法/搭配…）：复制对应提示词。 */
  const copyPrompt = async (task: AnalysisTask) => {
    const text = useExact && exact ? exact : sentence?.text || exact
    if (!text) {
      flash('先划一段文字或点一句')
      return
    }
    setLastTask(task)
    const singleWord = task === 'lookup' && exact && !exact.includes(' ') ? [exact] : []
    askedWordsRef.current = singleWord
    askedIdsRef.current = []
    const prompt = buildPrompt({ task, text, words: singleWord.length ? singleWord : undefined })
    await copy(prompt, '提示词已复制，去 chat.deepseek.com 粘贴')
  }

  /** 待选词一次性加入生词本。 */
  const commitBatch = () => {
    if (!visibleBatch.length) return
    let lib = library
    for (const b of visibleBatch) {
      lib = markWord(lib, {
        word: b.word,
        articleId: articleTitle || articleKey || '手动粘贴',
        fileName: articleIdentity,
        sentenceId: b.sentenceId,
        sentenceText: b.sentence,
        // 待选里保留了来源：手动点选 = manual；词典/一键挑词 = dict；AI 自动标词 = ai
        origin: b.via === 'manual' ? 'manual' : 'auto',
        via: b.via ?? 'batch',
      }).library
    }
    persist(lib)
    flash(`已加入 ${visibleBatch.length} 个生词`)
    setBatch([])
  }

  /** 待选词一键生成批量查词提示词。 */
  const copyBatchPrompt = async () => {
    if (!visibleBatch.length) return
    setLastTask('lookup')
    askedWordsRef.current = visibleBatch.map((b) => b.word)
    askedIdsRef.current = []
    await copy(
      buildBatchLookupPrompt(visibleBatch.map((b) => ({ word: b.word, context: b.sentence }))),
      `已复制 ${visibleBatch.length} 个词的查词提示词`,
    )
  }

  /** 从生词本里挑出缺音标的词（或全部），生成查词提示词。 */
  const copyMissingPhonetic = async (only: 'missing' | 'all') => {
    const todo = only === 'missing' ? library.items.filter((it) => !it.phonetic) : library.items
    if (!todo.length) {
      flash(only === 'missing' ? '生词都有音标了' : '生词本是空的')
      return
    }
    setLastTask('lookup')
    askedWordsRef.current = todo.map((it) => it.word)
    askedIdsRef.current = []
    await copy(
      buildBatchLookupPrompt(todo.map((it) => ({ word: it.word, context: it.source?.sentenceText }))),
      `已复制 ${todo.length} 个词，去 AI 粘贴后把结果贴回「应用结果」`,
    )
  }

  /** 全文翻译（按句 id）。 */
  const copyTranslateAll = async () => {
    if (!doc || !doc.sentences.length) {
      flash('先打开一篇文章')
      return
    }
    setLastTask('translate')
    askedIdsRef.current = doc.sentences.map((s) => s.id)
    askedWordsRef.current = []
    await copy(
      buildTranslateAllPrompt(doc.sentences.map((s) => ({ id: s.id, text: s.text }))),
      '已复制全文翻译提示词；把结果贴回「应用结果」',
    )
  }

  /** 自动标词：按词汇标准让 AI 从全文挑词，结果进「待选」。 */
  const copyAutoVocab = async () => {
    if (!doc || !doc.sentences.length) {
      flash('先打开一篇文章')
      return
    }
    setLastTask('auto_vocab')
    await copy(
      buildAutoVocabPrompt(doc.sentences.map((s) => s.text).join(' '), vocabLevel),
      '已复制自动标词提示词；把 AI 返回的词表粘到「应用结果」',
    )
  }

  /** 混淆项：为缺混淆项的词产出形近/义近干扰词。 */
  const copyConfusablePrompt = async () => {
    if (!confusableBatch.length) {
      flash('没有需要生成混淆项的词（需有释义）')
      return
    }
    setLastTask('confusable')
    askedWordsRef.current = confusableBatch.map((it) => it.word)
    askedIdsRef.current = []
    const rest = confusableTodo.length - confusableBatch.length
    await copy(
      buildConfusablePrompt(confusableBatch.map((it) => ({ word: it.word, meaning: it.meaning }))),
      rest > 0
        ? `已复制本批 ${confusableBatch.length} 个（还剩 ${rest}）；应用后再点一次继续`
        : `已复制 ${confusableBatch.length} 个词的混淆项提示词；结果粘回「应用结果」`,
    )
  }

  /** 原形校正。 */
  const copyLemmaPrompt = async () => {
    if (!lemmaCandidates.length) {
      flash('没有疑似非原型的词（word 与原形一致）')
      return
    }
    setLastTask('lemma')
    askedWordsRef.current = lemmaCandidates.map((it) => it.word)
    askedIdsRef.current = []
    await copy(
      buildLemmaPrompt(lemmaCandidates.map((it) => ({ word: it.word, context: it.source?.sentenceText }))),
      `已复制 ${lemmaCandidates.length} 个词的原形校正提示词；结果粘回「应用结果」`,
    )
  }

  /** -ing/-ed 语法辨析。 */
  const copyPosPrompt = async () => {
    if (!posCandidates.length) {
      flash('没有含 -ing/-ed 的词')
      return
    }
    setLastTask('pos')
    askedWordsRef.current = posCandidates.map((it) => it.word)
    askedIdsRef.current = []
    await copy(
      buildPosPrompt(posCandidates.map((it) => ({ word: it.word, context: it.source?.sentenceText }))),
      `已复制 ${posCandidates.length} 条 -ing/-ed 辨析提示词；结果粘回「应用结果」`,
    )
  }

  /** 去重整理（程序）：重算 lemma 后按 lemma 合并重复词条。 */
  const dedupeNow = () => {
    const before = library.items.length
    const next = dedupeLibrary(relemmaLibrary(library))
    persist(next)
    const removed = before - next.items.length
    flash(removed > 0 ? `已合并 ${removed} 个重复词` : '没有发现重复词')
  }

  return {
    copyPrompt,
    copyLanguagePrompt,
    copyGoldenPrompt,
    copyMissingAgain,
    commitBatch,
    copyBatchPrompt,
    copyMissingPhonetic,
    copyTranslateAll,
    copyAutoVocab,
    copyConfusablePrompt,
    copyLemmaPrompt,
    copyPosPrompt,
    dedupeNow,
  }
}
