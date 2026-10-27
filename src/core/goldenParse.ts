import { isObject, normalizeGoldenTargets, str, strList, type GoldenTextMeta } from './golden'
import type { GoldenLesson, GoldenPickMode, GoldenSection, GoldenSentence } from '../types/document'

/**
 * 外部输入（AI / 备份 / SQLite / IndexedDB）→ 金句课内容。
 * 句子 id 必须在当前文章里；目标必须逐字出现；坏内容丢弃而不是让整课失败。
 */
export function normalizeGoldenLesson(raw: unknown, sentences: GoldenTextMeta[]): GoldenLesson | null {
  if (!isObject(raw)) return null
  const byId = new Map(sentences.map((s) => [s.id, s]))
  const source = raw.source === 'ai' || raw.source === 'merged' || raw.source === 'local' ? raw.source : 'local'
  const out: GoldenSentence[] = []
  for (const item of Array.isArray(raw.sentences) ? raw.sentences : []) {
    if (!isObject(item)) continue
    const id = str(item.id)
    const sentence = byId.get(id)
    if (!id || !sentence) continue
    const targets = normalizeGoldenTargets(sentence.text, item.targets)
    const zh = str(item.zh) || str(sentence.translation)
    const pattern = str(item.pattern)
    const tense = str(item.tense)
    const note = str(item.note)
    if (!targets.length && !pattern && !tense && !note && !zh) continue
    out.push({
      id,
      ...(zh ? { zh } : {}),
      ...(pattern ? { pattern } : {}),
      ...(tense ? { tense } : {}),
      ...(note ? { note } : {}),
      targets,
    })
  }
  if (!out.length) return null
  const outline: GoldenSection[] = []
  for (const item of Array.isArray(raw.outline) ? raw.outline : []) {
    if (!isObject(item)) continue
    const paraId = str(item.paraId)
    const role = item.role === 'intro' || item.role === 'body' || item.role === 'conclusion' ? item.role : 'body'
    if (!paraId) continue
    const points = strList(item.points)
    outline.push({ paraId, role, ...(str(item.title) ? { title: str(item.title) } : {}), points })
  }
  const validIds = new Set(out.map((s) => s.id))
  const selected = strList(raw.selected).filter((id) => validIds.has(id))
  const aiSelected = strList(raw.aiSelected).filter((id) => validIds.has(id))
  const rawPick = isObject(raw.options) ? raw.options.pick : undefined
  const pick: GoldenPickMode | undefined =
    rawPick === 'recommended' || rawPick === 'all' || rawPick === 'manual' || rawPick === 'ai'
      ? rawPick
      : undefined
  const options: GoldenLesson['options'] = {
    dedupe: isObject(raw.options) ? raw.options.dedupe === true : false,
    ...(pick ? { pick } : {}),
  }
  return {
    version: 1,
    source,
    ...(str(raw.summary) ? { summary: str(raw.summary) } : {}),
    outline,
    sentences: out,
    selected: selected.length ? selected : out.map((s) => s.id),
    ...(aiSelected.length ? { aiSelected } : {}),
    options,
    ...(str(raw.updatedAt) ? { updatedAt: str(raw.updatedAt) } : {}),
  }
}

/**
 * 导入/合并文章时保住金句课：旧备份没有 golden 就保留现有的；
 * 两边都有时按文章 updatedAt 取较新的内容（进度在 LearningData，不在这里）。
 */
export function mergeGoldenIntoArticle<T extends { golden?: GoldenLesson; updatedAt: string }>(
  existing: T | null,
  incoming: T,
): T {
  const current = existing?.golden
  const next = incoming.golden
  const golden =
    next && (!current || incoming.updatedAt >= existing!.updatedAt) ? next : current ?? next
  return { ...incoming, ...(golden ? { golden } : {}) }
}

/** 改正文后丢掉已经不存在 / 内容对不上的句子；没有可练目标就整课作废。 */
export function pruneGoldenLesson(lesson: GoldenLesson | undefined, sentences: GoldenTextMeta[]): GoldenLesson | undefined {
  if (!lesson) return undefined
  const next = normalizeGoldenLesson(lesson, sentences)
  if (!next) return undefined
  const kept = next.sentences.filter((s) => s.targets.length > 0)
  if (!kept.length) return undefined
  const ids = new Set(kept.map((s) => s.id))
  return { ...next, sentences: kept, selected: next.selected.filter((id) => ids.has(id)) }
}
