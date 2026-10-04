import { useCallback, type Dispatch, type SetStateAction } from 'react'
import {
  applyToSentence,
  parseAnalysis,
  parseConfusables,
  parseLemmaTable,
  parsePosTable,
  parseWordList,
} from '../../core/analyzer'
import { applyLanguage, parseLanguage } from '../../core/language'
import { parseListeningQuiz, type ListeningQuiz } from '../../core/listening'
import { addWritingRecord, parseImitationTask, parseWritingFeedback, type ImitationTask, type WritingFeedback, type WritingRecord } from '../../core/writing'
import {
  applyConfusables,
  applyLemmaMap,
  applyPosAnalysis,
  applyWordAnalysis,
  dedupeLibrary,
  lemmaOf,
  normalizeWord,
} from '../../core/vocab'
import type { Sentence, VocabLibrary } from '../../types/document'
import type { ActivityCat } from '../../core/activity'
import type { AiTaskKey } from './useAiTasks'
import type { ReaderDoc } from './useReaderDoc'

type BatchItemLike = { word: string; sentence: string; sentenceId: string | null }

export interface ApplyOutcome {
  report: string[]
  missing: { task: 'confusable' | 'lookup' | 'lemma' | 'pos'; words: string[] } | null
  ok: boolean
}

export interface UseApplyTaskResultParams {
  library: VocabLibrary
  sentence: Sentence | null
  persist: (library: VocabLibrary) => void
  mergeBatch: (items: BatchItemLike[]) => void
  batchItemsFromWords: (words: string[]) => BatchItemLike[]
  articleTitle: string
  articleKey: string | null
  articleIdentity: string
  writingModel: string
  writingText: string
  writingTask: ImitationTask | null
  recordActivity: (cat: ActivityCat, n?: number) => void
  setDoc: Dispatch<SetStateAction<ReaderDoc | null>>
  setPendingSave: (v: boolean) => void
  setListenQuiz: (q: ListeningQuiz | null) => void
  setWritingTask: (t: ImitationTask | null) => void
  setWritingFeedback: (f: WritingFeedback | null) => void
  setWritingHistory: Dispatch<SetStateAction<WritingRecord[]>>
}

/** 请求的词里，AI 没返回的（按 lemma 比较）。 */
function missingWords(requested: string[], returned: string[]): string[] {
  const got = new Set(returned.map((w) => lemmaOf(w)))
  return requested.filter((w) => !got.has(lemmaOf(w)))
}

/**
 * 应用一份 AI 结果（按任务分派）。单条「应用结果」与整包导入都走这里。
 * 只做解析 + 落库，不动 UI 状态（回执 / 缺失 / 清空交给调用方）。
 */
export function useApplyTaskResult(params: UseApplyTaskResultParams) {
  const {
    library,
    sentence,
    persist,
    mergeBatch,
    batchItemsFromWords,
    articleTitle,
    articleKey,
    articleIdentity,
    writingModel,
    writingText,
    writingTask,
    recordActivity,
    setDoc,
    setPendingSave,
    setListenQuiz,
    setWritingTask,
    setWritingFeedback,
    setWritingHistory,
  } = params

  return useCallback(
    (task: AiTaskKey | null, raw: string, askedWords: string[], askedIds: string[]): ApplyOutcome => {
      const text = raw.trim()
      if (!text) return { report: [], missing: null, ok: false }

      // 自动标词：AI 返回的是一串单词 → 进「待选」清单（可增删，不直接落库）
      if (task === 'auto_vocab') {
        const words = parseWordList(text)
        if (!words.length)
          return { report: ['没解析出单词（应为一行一个，或逗号/顿号分隔）'], missing: null, ok: false }
        mergeBatch(batchItemsFromWords(words))
        return { report: [`已加入待选 ${words.length} 个词，可增删后再查词`], missing: null, ok: true }
      }

      // 混淆项：写到对应词条，供选择题当干扰项。先校验再落库。
      if (task === 'confusable') {
        const parsed = parseConfusables(text)
        if (!parsed.length)
          return { report: ['没解析出混淆项（格式：原词 | 词:释义 ; 词:释义）'], missing: null, ok: false }
        const libLemmas = new Set(library.items.map((it) => it.lemma))
        const valid = parsed
          .map((r) => ({
            ...r,
            confusables: r.confusables.filter((c) => c.word.trim() && lemmaOf(c.word) !== lemmaOf(r.word)),
          }))
          .filter((r) => r.confusables.length > 0)
        const applied = valid.filter((r) => libLemmas.has(lemmaOf(r.word)))
        const unknown = valid.filter((r) => !libLemmas.has(lemmaOf(r.word))).map((r) => r.word)
        const empty = parsed
          .filter((r) => r.confusables.every((c) => !c.word.trim() || lemmaOf(c.word) === lemmaOf(r.word)))
          .map((r) => r.word)
        const missing = missingWords(askedWords, valid.map((r) => r.word))

        const report: string[] = []
        if (applied.length) persist(applyConfusables(library, applied))
        report.push(`成功写入 ${applied.length} 个词的混淆项`)
        if (missing.length) {
          report.push(`AI 未返回 ${missing.length} 个：${missing.slice(0, 20).join('、')}${missing.length > 20 ? '…' : ''}`)
        }
        if (empty.length) report.push(`内容无效 ${empty.length} 个（缺有效易混词）：${empty.slice(0, 10).join('、')}`)
        if (unknown.length) report.push(`词库里没有 ${unknown.length} 个：${unknown.slice(0, 10).join('、')}`)
        return { report, missing: missing.length ? { task: 'confusable', words: missing } : null, ok: true }
      }

      // 原形校正：改 word/lemma，再合并重复
      if (task === 'lemma') {
        const pairs = parseLemmaTable(text)
        if (!pairs.length) return { report: ['没解析出原形（格式：原词形 | 原形）'], missing: null, ok: false }
        const before = library.items.length
        const next = dedupeLibrary(applyLemmaMap(library, pairs))
        persist(next)
        const changed = pairs.filter((p) => normalizeWord(p.from) !== normalizeWord(p.to)).length
        const merged = before - next.items.length
        const report: string[] = [`校正 ${changed} 个词形（共 ${pairs.length} 行）`]
        if (merged > 0) report.push(`合并去重 ${merged} 个`)
        const missing = missingWords(askedWords, pairs.map((p) => p.from))
        if (missing.length) {
          report.push(`AI 未返回 ${missing.length} 个：${missing.slice(0, 20).join('、')}${missing.length > 20 ? '…' : ''}`)
        }
        return { report, missing: missing.length ? { task: 'lemma', words: missing } : null, ok: true }
      }

      // -ing/-ed 语法辨析：写回原形 / 词性 / 笔记
      if (task === 'pos') {
        const rows = parsePosTable(text)
        if (!rows.length)
          return { report: ['没解析出辨析结果（应为 8 列：原形 | 当前形式 | … | 最准确词性标注）'], missing: null, ok: false }
        const before = library.items.length
        const next = dedupeLibrary(applyPosAnalysis(library, rows))
        persist(next)
        const merged = before - next.items.length
        const surfaces = rows.map((r) => normalizeWord(r.surface)).filter(Boolean)
        const missing = askedWords.filter((w) => {
          const nw = normalizeWord(w)
          return !surfaces.some((s) => nw === s || nw.split(' ').includes(s))
        })
        const report: string[] = [`已写回 ${rows.length} 条辨析`]
        if (merged > 0) report.push(`合并去重 ${merged} 个`)
        if (missing.length) {
          report.push(`AI 未覆盖 ${missing.length} 个：${missing.slice(0, 20).join('、')}${missing.length > 20 ? '…' : ''}`)
        }
        return { report, missing: missing.length ? { task: 'pos', words: missing } : null, ok: true }
      }

      // 听力理解题：解析严格 JSON 并存起来
      if (task === 'listening') {
        const quiz = parseListeningQuiz(text)
        if (!quiz.questions.length)
          return { report: ['没解析出题目（需要严格 JSON：{"questions":[…] }，含 type/stem/answer）'], missing: null, ok: false }
        setListenQuiz(quiz)
        try {
          localStorage.setItem('reader:listening:' + articleIdentity, JSON.stringify(quiz))
        } catch {
          // 忽略
        }
        return { report: [`已生成 ${quiz.questions.length} 道题`, '点工具栏「理解题」开始作答'], missing: null, ok: true }
      }

      // 逐句语言点：写回句子
      if (task === 'language') {
        const rows = parseLanguage(text)
        if (!rows.length)
          return { report: ['没解析出语言点（需要 JSON：{"sentences":[{"id":…}] }）'], missing: null, ok: false }
        setDoc((d) => (d ? { ...d, sentences: applyLanguage(d.sentences, rows) } : d))
        setPendingSave(true)
        recordActivity('write', rows.length)
        const got = new Set(rows.map((r) => r.id))
        const missing = askedIds.filter((id) => !got.has(id))
        const report = [`已写入 ${rows.length} 句语言点`]
        if (missing.length) {
          report.push(`AI 未返回 ${missing.length} 句：${missing.slice(0, 20).join('、')}${missing.length > 20 ? '…' : ''}`)
        }
        return { report, missing: null, ok: true }
      }

      // 仿写：生成任务
      if (task === 'imitation') {
        const t = parseImitationTask(text)
        if (!t) return { report: ['没解析出仿写任务（需要 JSON：{task, model, rubric}）'], missing: null, ok: false }
        setWritingTask(t)
        setWritingFeedback(null)
        return { report: [`已生成仿写任务（${t.rubric.length} 个维度）`], missing: null, ok: true }
      }
      // 仿写：批改
      if (task === 'feedback') {
        const f = parseWritingFeedback(text)
        if (!f) return { report: ['没解析出批改结果（需要 JSON：{scores, issues, polished}）'], missing: null, ok: false }
        setWritingFeedback(f)
        setWritingHistory((h) =>
          addWritingRecord(h, {
            at: new Date().toISOString(),
            articleId: articleIdentity,
            articleTitle: articleTitle || undefined,
            model: writingModel,
            text: writingText,
            feedback: f,
            task: writingTask ?? undefined,
          }),
        )
        recordActivity('write', 1)
        return { report: [`批改完成：${f.total}/${f.max}，${f.issues.length} 处修改`], missing: null, ok: true }
      }

      // 通用：查词表格 / 逐句翻译 / JSON
      const result = parseAnalysis(text)
      const report: string[] = []
      let missing: { task: 'lookup'; words: string[] } | null = null
      let next = library
      if (result.words?.length) {
        next = dedupeLibrary(
          applyWordAnalysis(next, result.words, new Date(), {
            articleId: articleTitle || articleKey || '手动粘贴',
            fileName: articleIdentity,
            sentenceId: null,
            sentenceText: '',
          }),
        )
      }
      if (result.sentences?.length) {
        const map = new Map(result.sentences.map((x) => [x.sentenceId, x]))
        setDoc((d) =>
          d
            ? {
                ...d,
                sentences: d.sentences.map((s) => {
                  const a = map.get(s.id)
                  if (!a) return s
                  return {
                    ...s,
                    translation: a.translation ?? s.translation,
                    grammarNote: a.grammarNote ?? s.grammarNote,
                    collocations: a.collocations ? [...new Set([...s.collocations, ...a.collocations])] : s.collocations,
                    vocab: a.vocab ? [...new Set([...s.vocab, ...a.vocab])] : s.vocab,
                  }
                }),
              }
            : d,
        )
        recordActivity('read', result.sentences.length)
      }
      const fellBack = !result.words?.length && !result.sentences?.length && !!task && !!sentence
      if (fellBack && task) {
        const updated = applyToSentence(sentence, task, text)
        setDoc((d) => (d ? { ...d, sentences: d.sentences.map((x) => (x.id === updated.id ? updated : x)) } : d))
      }

      // 一点都没解析出来：返回失败（调用方保留粘贴内容，方便改格式重试）
      if (!result.words?.length && !result.sentences?.length && !fellBack) {
        return { report: ['没解析出可用内容（查词表格 / 逐句翻译 / JSON）；检查格式后重试'], missing: null, ok: false }
      }

      persist(next)
      if (result.sentences?.length || fellBack) setPendingSave(true)

      if (result.words?.length) {
        report.push(`已填入 ${result.words.length} 个词条`)
        if (askedWords.length) {
          const m = missingWords(askedWords, result.words.map((w) => w.word))
          if (m.length) {
            report.push(`AI 未返回 ${m.length} 个：${m.slice(0, 20).join('、')}${m.length > 20 ? '…' : ''}`)
            missing = { task: 'lookup', words: m }
          }
        }
        const noPhon = result.words.filter((w) => !w.phonetic).length
        const noMean = result.words.filter((w) => !w.meaning).length
        if (noPhon) report.push(`其中 ${noPhon} 个没音标`)
        if (noMean) report.push(`其中 ${noMean} 个没释义`)
      }
      if (result.sentences?.length) {
        report.push(`已更新 ${result.sentences.length} 句`)
        if (askedIds.length) {
          const got = new Set(result.sentences.map((x) => x.sentenceId))
          const m = askedIds.filter((id) => !got.has(id))
          if (m.length) {
            report.push(`AI 未返回 ${m.length} 句：${m.slice(0, 20).join('、')}${m.length > 20 ? '…' : ''}`)
          }
        }
      }
      if (fellBack) report.push('已按所选句子落上结果')
      return { report: report.length ? report : ['已应用'], missing, ok: true }
    },
    [
      library,
      sentence,
      persist,
      mergeBatch,
      batchItemsFromWords,
      articleTitle,
      articleKey,
      articleIdentity,
      writingModel,
      writingText,
      writingTask,
      recordActivity,
      setDoc,
      setPendingSave,
      setListenQuiz,
      setWritingTask,
      setWritingFeedback,
      setWritingHistory,
    ],
  )
}
