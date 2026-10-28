import { cleanVocabWord } from '../../core/analyzer'
import {
  dictLemmaOf,
  levelVerdict,
  pickAboveLevelWords,
} from '../../core/ecdict'
import { lemmaOf } from '../../core/vocab'
import { dictionary } from '../../adapters/dictionary'
import { AI_BATCH_NAME } from '../labels'
import type { ApplyContext, ApplyOutcome } from './types'

/**
 * 自动标词：AI 返回的是一串单词 → 清洗 → 用离线词典归一到原形、按级别过滤 → 进「待选」。
 * 词库来源句、回执口径都在这里，通用查词不要复用这段（两者的输入形状不同）。
 */
export function applyAutoVocab(ctx: ApplyContext): ApplyOutcome {
  const {
    text,
    currentLibrary,
    ecdictLevel,
    articleText,
    batchItemsFromWords,
    autoVocabDirect,
    commitBatchItems,
    mergeBatch,
  } = ctx

  // AI 可能一行给好几个词、或逗号分隔，还可能带编号/词性/中文 → 统一切开再清洗成纯单词
  const parsed = text
    .split(/[\s,，、;；\n\r]+/)
    .map(cleanVocabWord)
    .filter((w) => w.length >= 2 && /^[A-Za-z][A-Za-z'\-]*$/.test(w))
  let words = [...new Set(parsed)]
  if (!words.length) return { report: ['没解析出单词（AI 应每行一个单词）'], missing: null, ok: false }

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
  const existing = new Set(currentLibrary.items.map((it) => it.lemma))
  const newCount = words.filter((w) => !existing.has(lemmaOf(w))).length
  const mergedCount = words.length - newCount
  const split = mergedCount > 0 ? `（新 ${newCount} · 已在生词本 ${mergedCount}）` : ''
  const items = batchItemsFromWords(words, 'ai')

  if (autoVocabDirect) {
    // 直入模式：跳过「待选」，直接进生词本（状态未查），下次跑批自动补音标/释义
    commitBatchItems(items)
    return {
      report: [`已直接加入生词本 ${words.length} 个词${split}${note}`, `下次${AI_BATCH_NAME}会补齐它们的音标/释义`],
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
