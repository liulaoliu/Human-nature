import { isObject, normalizeGoldenTargets, str, strList, type GoldenTextMeta } from './golden'
import { normalizeGoldenExam, pruneGoldenExam } from './goldenExam'
import type {
  GoldenExtraPoint,
  GoldenLesson,
  GoldenPickMode,
  GoldenSection,
  GoldenSentence,
} from '../types/document'

const EXTRA_KINDS = ['chunk', 'pattern', 'collocation', 'idiom', 'usage'] as const

function extraKey(sentenceId: string, en: string): string {
  return `${sentenceId}\u0000${en.replace(/\s+/g, ' ').trim().toLowerCase()}`
}

/**
 * 「加入本课」的语言点：句子必须还在；同句同英文去重；最多 50 条。
 * 这是外部输入（备份 / SQLite / AI 推荐），坏条目丢弃，不拖垮整课。
 */
export function normalizeGoldenExtraPoints(
  raw: unknown,
  sentenceIds: ReadonlySet<string>,
): GoldenExtraPoint[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: GoldenExtraPoint[] = []
  for (const item of raw) {
    if (!isObject(item)) continue
    const sentenceId = str(item.sentenceId)
    const en = str(item.en).replace(/\s+/g, ' ')
    if (!sentenceId || !en || !sentenceIds.has(sentenceId)) continue
    const kind = (EXTRA_KINDS as readonly string[]).includes(str(item.kind))
      ? (str(item.kind) as GoldenExtraPoint['kind'])
      : 'chunk'
    const source = item.source === 'user' ? 'user' : item.source === 'ai' ? 'ai' : 'user'
    const key = extraKey(sentenceId, en)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      sentenceId,
      en,
      ...(str(item.zh) ? { zh: str(item.zh) } : {}),
      kind,
      source,
      ...(str(item.issueKey) ? { issueKey: str(item.issueKey) } : {}),
      ...(str(item.at) ? { at: str(item.at) } : {}),
    })
    if (out.length >= 50) break
  }
  return out
}


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
  const extraPoints = normalizeGoldenExtraPoints(raw.extraPoints, validIds)
  const selected = strList(raw.selected).filter((id) => validIds.has(id))
  const aiSelected = strList(raw.aiSelected).filter((id) => validIds.has(id))
  const rawPick = isObject(raw.options) ? raw.options.pick : undefined
  const pick: GoldenPickMode | undefined =
    rawPick === 'recommended' || rawPick === 'all' || rawPick === 'manual' || rawPick === 'ai'
      ? rawPick
      : undefined
  const rawBlankUnit = isObject(raw.options) ? raw.options.blankUnit : undefined
  const blankUnit: 'word' | 'target' | undefined =
    rawBlankUnit === 'target' ? 'target' : rawBlankUnit === 'word' ? 'word' : undefined
  const rawSentenceFill = isObject(raw.options) ? raw.options.sentenceFill : undefined
  const sentenceFill = rawSentenceFill === false ? false : rawSentenceFill === true ? true : undefined
  const examAfter: 5 | 10 | undefined = isObject(raw.options) && raw.options.examAfter === 10 ? 10 : undefined
  const exam = normalizeGoldenExam(raw.exam, sentences, 'ai')
  const options: GoldenLesson['options'] = {
    dedupe: isObject(raw.options) ? raw.options.dedupe === true : false,
    ...(pick ? { pick } : {}),
    ...(blankUnit ? { blankUnit } : {}),
    ...(sentenceFill === undefined ? {} : { sentenceFill }),
    ...(examAfter ? { examAfter } : {}),
  }
  return {
    version: 1,
    source,
    ...(str(raw.summary) ? { summary: str(raw.summary) } : {}),
    outline,
    sentences: out,
    selected: selected.length ? selected : out.map((s) => s.id),
    ...(aiSelected.length ? { aiSelected } : {}),
    ...(extraPoints.length ? { extraPoints } : {}),
    ...(exam.length ? { exam } : {}),
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
  const base =
    next && (!current || incoming.updatedAt >= existing!.updatedAt) ? next : current ?? next
  if (!base) return { ...incoming }
  // 用户点「加入本课」的结果不能因为重新生成 / 导入旧备份就丢；两边取并集。
  const seen = new Set<string>()
  const extraPoints = [...(current?.extraPoints ?? []), ...(next?.extraPoints ?? [])].filter(
    (p) => {
      const key = extraKey(p.sentenceId, p.en)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    },
  )
  const merged = extraPoints.length ? { ...base, extraPoints } : base
  return { ...incoming, golden: merged }
}

/** 改正文后丢掉已经不存在 / 内容对不上的句子；没有可练目标就整课作废。 */
export function pruneGoldenLesson(lesson: GoldenLesson | undefined, sentences: GoldenTextMeta[]): GoldenLesson | undefined {
  if (!lesson) return undefined
  const next = normalizeGoldenLesson(lesson, sentences)
  if (!next) return undefined
  const kept = next.sentences.filter((s) => s.targets.length > 0)
  if (!kept.length) return undefined
  const ids = new Set(kept.map((s) => s.id))
  const exam = pruneGoldenExam(next.exam, sentences)
  return {
    ...next,
    sentences: kept,
    selected: next.selected.filter((id) => ids.has(id)),
    ...(exam ? { exam } : { exam: undefined }),
  }
}
