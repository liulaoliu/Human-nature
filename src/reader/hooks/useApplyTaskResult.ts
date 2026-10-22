import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { applyToSentence, cleanVocabWord, parseAnalysis, type AnalysisTask } from '../../core/analyzer'
import { applyLanguage, parseLanguage } from '../../core/language'
import { parseListeningQuiz, type ListeningQuiz } from '../../core/listening'
import {
  addWritingRecord,
  parseImitationTask,
  parseWritingFeedback,
  type ImitationTask,
  type WritingFeedback,
  type WritingRecord,
} from '../../core/writing'
import { applyWordAnalysis, dedupeLibrary, lemmaOf } from '../../core/vocab'
import { applyTableTask, missingWords, type ApplyTableTask } from '../../core/aiApply'
import type { MissingTask } from '../missingPrompts'
import type { Sentence, VocabFieldSources, VocabLibrary, VocabVia } from '../../types/document'
import type { ActivityCat } from '../../core/activity'
import {
  dictLemmaOf,
  glossForPos,
  levelVerdict,
  pickAboveLevelWords,
  resolveWord,
  type EcdictLevel,
} from '../../core/ecdict'
import { dictionary, mwldLookupWord } from '../../adapters/dictionary'
import type { AiTaskKey } from './useAiTasks'
import type { ReaderDoc } from './useReaderDoc'

type BatchItemLike = { word: string; sentence: string; sentenceId: string | null; via?: VocabVia }

export interface ApplyOutcome {
  report: string[]
  /** 缺失任务 + 缺的词；类型跟「复制未返回的」提示词共用一份（reader/missingPrompts） */
  missing: { task: MissingTask; words: string[] } | null
  ok: boolean
}

export interface UseApplyTaskResultParams {
  library: VocabLibrary
  /** 词库的可变引用：一次跑批里多个任务挨个应用时用它串起来，避免相互覆盖。 */
  libraryRef: MutableRefObject<VocabLibrary>
  sentence: Sentence | null
  persist: (library: VocabLibrary) => void
  mergeBatch: (items: BatchItemLike[]) => void
  batchItemsFromWords: (words: string[], via?: VocabVia) => BatchItemLike[]
  /** 自动标词直入：true = 直接写进生词本（跳过「待选」）。 */
  autoVocabDirect: boolean
  /** 把词条直接加进生词本（按原形去重）。 */
  commitBatchItems: (items: BatchItemLike[]) => void
  articleTitle: string
  articleKey: string | null
  articleIdentity: string
  /** 听力题缓存键（`core/docSignature.articleKey`，与 `useListening` 读取时一致）。 */
  listeningKey: string
  writingModel: string
  writingText: string
  writingTask: ImitationTask | null
  recordActivity: (cat: ActivityCat, n?: number) => void
  /** 自动标词的词汇水平（用离线词典按 tag 过滤超纲词）。 */
  ecdictLevel: EcdictLevel
  /** 当前文章正文（AI 给词太少时，用离线词典补几个）。 */
  articleText: string
  /** 某个词在本篇里的那句来源（写回来源/语境用）。 */
  sentenceForWord: (word: string) => { sentence: string; sentenceId: string | null }
  setDoc: Dispatch<SetStateAction<ReaderDoc | null>>
  setPendingSave: (v: boolean) => void
  setListenQuiz: (q: ListeningQuiz | null) => void
  setWritingTask: (t: ImitationTask | null) => void
  setWritingFeedback: (f: WritingFeedback | null) => void
  setWritingHistory: Dispatch<SetStateAction<WritingRecord[]>>
}

/**
 * 「解析表格 → 写库」那类任务：规则全在 `core/aiApply`（那边有逐条测试），
 * 这里只做分派 + 落库，不再各写一份 report。
 */
const TABLE_TASKS: Partial<Record<AiTaskKey, ApplyTableTask>> = {
  confusable: 'confusable',
  example: 'example',
  phrase: 'phrase',
  grammar_mark: 'grammar_mark',
  lemma: 'lemma',
  pos: 'pos',
}

/**
 * 应用一份 AI 结果（按任务分派）。单条「应用结果」与整包导入都走这里。
 * 只做解析 + 落库，不动 UI 状态（回执 / 缺失 / 清空交给调用方）。
 */
export function useApplyTaskResult(params: UseApplyTaskResultParams) {
  const {
    library,
    libraryRef,
    sentence,
    persist,
    mergeBatch,
    batchItemsFromWords,
    autoVocabDirect,
    commitBatchItems,
    articleTitle,
    articleKey,
    articleIdentity,
    listeningKey,
    writingModel,
    writingText,
    writingTask,
    recordActivity,
    ecdictLevel,
    articleText,
    sentenceForWord,
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

      // 本次应用基于「当前最新词库」；每写一次就更新 ref，供同一批里的下一条接着用，
      // 避免多条任务各拿同一份旧库互相覆盖（会导致某些词永远补不上、反复待办）。
      const lib = libraryRef.current
      const commit = (next: VocabLibrary) => {
        libraryRef.current = next
        persist(next)
      }

      // 表格型任务：解析 / 校验 / 回执都在 core/aiApply，这里只落库
      const tableTask = task ? TABLE_TASKS[task] : undefined
      if (tableTask) {
        const out = applyTableTask(tableTask, text, lib, askedWords)
        if (out.next) commit(out.next)
        return { report: out.report, missing: out.missing, ok: out.ok }
      }

      // 一种任务 = 一个处理器（注册表）；新增 AI 任务只在这里加一条，不再改 if 链
      const handlers: Partial<Record<AiTaskKey, () => ApplyOutcome>> = {}

      // 自动标词：AI 返回的是一串单词 → 清洗 → 用离线词典归一到原形、按级别过滤 → 进「待选」
      handlers.auto_vocab = () => {
        // AI 可能一行给好几个词、或逗号分隔，还可能带编号/词性/中文 → 统一切开再清洗成纯单词
        const parsed = text
          .split(/[\s,，、;；\n\r]+/)
          .map(cleanVocabWord)
          .filter((w) => w.length >= 2 && /^[A-Za-z][A-Za-z'\-]*$/.test(w))
        let words = [...new Set(parsed)]
        if (!words.length)
          return { report: ['没解析出单词（AI 应每行一个单词）'], missing: null, ok: false }
        let within = 0
        let rare = 0
        let unknown = 0
        let fellBack = false
        const notes: string[] = []
        const dict = dictionary()
        if (dict) {
          const byLemma = new Map<string, string>()
          for (const w of words) {
            const lemma = dictLemmaOf(dict, w) ?? w
            const key = lemma.toLowerCase()
            if (!byLemma.has(key)) byLemma.set(key, lemma)
          }
          const kept: string[] = []
          for (const w of byLemma.values()) {
            const verdict = levelVerdict(dict, w, ecdictLevel)
            if (verdict === 'within') within++
            else if (verdict === 'rare') rare++
            else {
              if (verdict === 'unknown') unknown++ // 词典没收录：不能因此丢掉
              kept.push(w)
            }
          }
          // 兜底：词典把 AI 给的词全筛了 → 宁可保留 AI 原词，也别一个都不给
          if (kept.length) words = kept
          else if (words.length) fellBack = true
        }
        // AI 给得太少 → 用离线词典补几个（确定性、免费，不额外花 token）
        const MIN_AUTO = 12
        if (dict && words.length < MIN_AUTO && articleText.trim()) {
          const fromAi = words.length
          const have = new Set(words.map((w) => lemmaOf(w)))
          const extra = pickAboveLevelWords(dict, articleText, ecdictLevel, 40)
            .filter((w) => !have.has(lemmaOf(w)))
            .slice(0, 40 - words.length)
          if (extra.length) {
            words = [...words, ...extra]
            notes.push(`AI 只给了 ${fromAi} 个，离线补 ${extra.length} 个`)
          }
        }
        if (!words.length)
          return { report: ['自动标词没产出词（换「词汇标准」后重试，或点「开启自动标词」重跑）'], missing: null, ok: true }
        if (fellBack) notes.push('词典把这些词都判成「非超纲」，已按 AI 原词保留')
        if (within) notes.push(`滤掉 ${within} 个本档以内`)
        if (rare) notes.push(`滤掉 ${rare} 个太生僻`)
        if (unknown) notes.push(`${unknown} 个词典未收录已保留`)
        const note = notes.length ? `（${notes.join('；')}）` : ''
        // 区分「新加入」和「本来就在库」：不然会觉得"怎么才加这么点"
        const existing = new Set(lib.items.map((it) => it.lemma))
        const newCount = words.filter((w) => !existing.has(lemmaOf(w))).length
        const mergedCount = words.length - newCount
        const split =
          mergedCount > 0 ? `（新 ${newCount} · 已在生词本 ${mergedCount}）` : ''
        const items = batchItemsFromWords(words, 'ai')
        if (autoVocabDirect) {
          // 直入模式：跳过「待选」，直接进生词本（状态未查），下次跑批自动补音标/释义
          commitBatchItems(items)
          return {
            report: [`已直接加入生词本 ${words.length} 个词${split}${note}`, '下次跑批会补齐它们的音标/释义'],
            missing: null,
            ok: true,
          }
        }
        mergeBatch(items)
        return {
          report: [`已加入待选 ${words.length} 个词${split}${note}，可增删后再查词`],
          missing: null,
          ok: true,
        }
      }

      // 听力理解题：解析严格 JSON 并存起来
      handlers.listening = () => {
        const quiz = parseListeningQuiz(text)
        if (!quiz.questions.length)
          return { report: ['没解析出题目（需要严格 JSON：{"questions":[…] }，含 type/stem/answer）'], missing: null, ok: false }
        setListenQuiz(quiz)
        try {
          localStorage.setItem('reader:listening:' + listeningKey, JSON.stringify(quiz))
        } catch {
          // 忽略
        }
        return { report: [`已生成 ${quiz.questions.length} 道题`, '点工具栏「理解题」开始作答'], missing: null, ok: true }
      }

      // 逐句语言点：写回句子
      handlers.language = () => {
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
      handlers.imitation = () => {
        const t = parseImitationTask(text)
        if (!t) return { report: ['没解析出仿写任务（需要 JSON：{task, model, rubric}）'], missing: null, ok: false }
        setWritingTask(t)
        setWritingFeedback(null)
        return { report: [`已生成仿写任务（${t.rubric.length} 个维度）`], missing: null, ok: true }
      }
      // 仿写：批改
      handlers.feedback = () => {
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

      // 任务注册表命中就直接执行；没命中的（lookup / analysis 等）走下面的通用解析
      const handler = task ? handlers[task] : undefined
      if (handler) return handler()

      // 通用：查词表格 / 逐句翻译 / JSON
      const result = parseAnalysis(text)
      const report: string[] = []
      let missing: { task: 'lookup'; words: string[] } | null = null
      let next = lib
      if (result.words?.length) {
        // 用离线词典校验/补全：归一到原形，并补齐缺失的音标/词性/中英释义（英文释义优先 M-W）
        const dict = dictionary()
        const wordsForApply = result.words.map((w) => {
          const hit = dict ? resolveWord(dict, w.word) : null
          const mw = mwldLookupWord(w.word)
          const e = hit?.entry
          // 每个字段分别记来源：AI 没给的才用离线词典补，不能整条算 AI
          const fieldSources: VocabFieldSources = {}
          const ph = mw?.phonetic || e?.phonetic
          const phonetic = w.phonetic || (ph ? `/${ph.replace(/^\/+|\/+$/g, '')}/` : undefined)
          const partOfSpeech = w.partOfSpeech || mw?.pos || e?.pos || undefined
          // 词典释义是多行的，每行自带词性标记；按词性挑，别硬取第一行
          // （否则 vow 会变成「v. n. 誓约」，卡上两个词性打架）
          const meaning = w.meaning || (e?.zh ? glossForPos(e.zh, partOfSpeech || '') : undefined)
          const definition = w.definition || mw?.en || (e?.en ? glossForPos(e.en, partOfSpeech || '') : undefined)
          if (phonetic) fieldSources.phonetic = w.phonetic ? 'ai' : 'dict'
          if (partOfSpeech) fieldSources.partOfSpeech = w.partOfSpeech ? 'ai' : 'dict'
          if (meaning) fieldSources.meaning = w.meaning ? 'ai' : 'dict'
          if (definition) fieldSources.definition = w.definition ? 'ai' : 'dict'
          return {
            ...w,
            word: hit?.lemma ?? w.word,
            phonetic,
            partOfSpeech,
            meaning,
            definition,
            fieldSources: Object.keys(fieldSources).length ? fieldSources : undefined,
          }
        })
        // 逐词写回，带上它在**本篇**里的那句来源（来源不空 + 记一条本篇语境）
        let applied = next
        for (const w of wordsForApply) {
          const ctx = sentenceForWord(w.word)
          applied = applyWordAnalysis(applied, [w], new Date(), {
            articleId: articleTitle || articleKey || '手动粘贴',
            fileName: articleIdentity,
            sentenceId: ctx.sentenceId,
            sentenceText: ctx.sentence,
          })
        }
        next = dedupeLibrary(applied)
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
        // 注册表里的任务已在上面 return；能走到这里且带 task 的都是 AnalysisTask
        const updated = applyToSentence(sentence, task as AnalysisTask, text)
        setDoc((d) => (d ? { ...d, sentences: d.sentences.map((x) => (x.id === updated.id ? updated : x)) } : d))
      }

      // 一点都没解析出来：返回失败（调用方保留粘贴内容，方便改格式重试）
      if (!result.words?.length && !result.sentences?.length && !fellBack) {
        return { report: ['没解析出可用内容（查词表格 / 逐句翻译 / JSON）；检查格式后重试'], missing: null, ok: false }
      }

      commit(next)
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
      libraryRef,
      sentence,
      persist,
      mergeBatch,
      batchItemsFromWords,
      autoVocabDirect,
      commitBatchItems,
      articleTitle,
      articleKey,
      articleIdentity,
      listeningKey,
      writingModel,
      writingText,
      writingTask,
      recordActivity,
      ecdictLevel,
      articleText,
      sentenceForWord,
      setDoc,
      setPendingSave,
      setListenQuiz,
      setWritingTask,
      setWritingFeedback,
      setWritingHistory,
    ],
  )
}
