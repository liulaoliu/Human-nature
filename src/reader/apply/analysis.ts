import { applyToSentence, parseAnalysis, type AnalysisTask } from '../../core/analyzer'
import { missingWords } from '../../core/aiApply'
import { glossForPos, resolveWord } from '../../core/ecdict'
import { applyWordAnalysis, dedupeLibrary, normalizePos, posFromGloss } from '../../core/vocab'
import { dictionary, mwldLookupWord } from '../../adapters/dictionary'
import type { VocabFieldSources } from '../../types/document'
import type { ApplyContext, ApplyOutcome } from './types'

/**
 * 通用解析：查词表格 / 逐句翻译 / 选中句的语法分析。
 *
 * 词条补全的「AI 优先、词典只补空缺」口径在这里；表格型任务和专用任务不走这段。
 */
export function applyAnalysisResult(ctx: ApplyContext): ApplyOutcome {
  const {
    text,
    task,
    askedWords,
    askedIds,
    sentence,
    sentenceForWord,
    articleTitle,
    articleKey,
    articleIdentity,
    recordActivity,
    setDoc,
    setPendingSave,
    currentLibrary,
    commit,
  } = ctx

  const result = parseAnalysis(text)
  const report: string[] = []
  let missing: ApplyOutcome['missing'] = null
  let next = currentLibrary

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
      // 词性 / 释义 / 英英必须同源：AI 给了释义却没给词性时**不能**拿词典的词性顶上，
      // 词典给的是词头首义（rival 一定是 n.），AI 给的是语境义，凑一起就是「n. 与……匹敌」。
      let partOfSpeech = w.partOfSpeech || undefined
      // 词典释义是多行的，每行自带词性标记；按词性挑，别硬取第一行
      // （否则 vow 会变成「v. n. 誓约」，卡上两个词性打架）
      const meaning = w.meaning || (e?.zh ? glossForPos(e.zh, partOfSpeech || '') : undefined)
      if (!w.partOfSpeech) {
        // 释义来自词典时，词性取同一行的标记；释义来自 AI 时，词性只认 AI 自己给的
        partOfSpeech = w.meaning ? undefined : (posFromGloss(meaning) || normalizePos(mw?.pos || e?.pos || '') || undefined)
      }
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
      const source = sentenceForWord(w.word)
      applied = applyWordAnalysis(applied, [w], new Date(), {
        articleId: articleTitle || articleKey || '手动粘贴',
        fileName: articleIdentity,
        sentenceId: source.sentenceId,
        sentenceText: source.sentence,
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
}
