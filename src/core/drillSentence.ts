/**
 * 记忆 / 词块拷打结束后的「用学过的内容造句」。
 *
 * 这里只做三件纯事：
 *   1. 从本轮考到的词条里挑出能直接写进英文句子的内容（记忆 = 单词，词块 = 词组 / 习语 / 英文用法）；
 *   2. 拼成一道 `GoldenExamItem`，让 `useGoldenImitation` 原样复用金句课本句仿写的批改链路；
 *   3. 中文用法笔记不当 `mustUse`（“so-called 常带保留态度”没法写进英文句子）。
 *
 * 批改 / 解析 / 粘贴 / 历史全走 `useGoldenImitation` + `GoldenSentenceImitation`，不另写一套。
 */
import type { GoldenExamItem, VocabItem } from '../types/document'
import { splitGlossText } from './langPoints'

export type DrillSentenceKind = 'memory' | 'chunk'

/** 一轮造句最多取几个词 / 词块：取太多会变成 10 句翻译，没人写。 */
export const DRILL_SENTENCE_MAX_POINTS = 5

export interface DrillSentencePoint {
  /** 同一轮里的稳定身份（词条 id + 英文片段），只给 React 当 key。 */
  id: string
  itemId: string
  /** 必须用上的英文片段。 */
  en: string
  /** 中文提示：记忆拷打取词义，词块取「英文 — 中文」里的中文。 */
  zh?: string
}

const CJK_RE = /[\u3400-\u9fff]/
const HAS_LATIN_RE = /[a-z]/i

const keyOf = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

function slugOf(text: string): string {
  return keyOf(text)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function pointId(kind: DrillSentenceKind, itemId: string, en: string): string {
  return `drill:${kind}:${itemId}:${slugOf(en) || 'x'}`
}

/** 英文片段才配当 mustUse：中文说明、空串都跳过。 */
function usableChunk(raw: string): { en: string; zh?: string } | null {
  const { word, gloss } = splitGlossText(raw)
  const en = word.replace(/\s+/g, ' ').trim()
  if (!en || CJK_RE.test(en) || !HAS_LATIN_RE.test(en)) return null
  return { en, ...(gloss?.trim() ? { zh: gloss.trim() } : {}) }
}

/**
 * 由「本轮考到的词条 id」反推造句素材（题目是唯一事实来源，和预习卡同一口径）。
 *
 * 记忆拷打：每个词条一个点，中文用词义。
 * 词块拷打：优先取词条里的 phrases / idioms / 英文 usage；一个都没有时退回单词本身，
 * 避免「词块数据缺了」就整块造句消失。
 */
export function drillSentencePoints(
  items: ReadonlyArray<VocabItem>,
  results: ReadonlyArray<{ itemId: string }>,
  kind: DrillSentenceKind,
  limit = DRILL_SENTENCE_MAX_POINTS,
): DrillSentencePoint[] {
  const byId = new Map(items.map((it) => [it.id, it]))
  const seenItems = new Set<string>()
  const seenText = new Set<string>()
  const out: DrillSentencePoint[] = []
  const max = Math.max(0, Math.floor(limit))
  if (!max) return out

  const push = (item: VocabItem, en: string, zh: string | undefined) => {
    const key = keyOf(en)
    if (!key || seenText.has(key)) return
    seenText.add(key)
    out.push({
      id: pointId(kind, item.id, en),
      itemId: item.id,
      en,
      ...(zh?.trim() ? { zh: zh.trim() } : {}),
    })
  }

  for (const row of results) {
    if (out.length >= max) break
    if (seenItems.has(row.itemId)) continue
    seenItems.add(row.itemId)
    const item = byId.get(row.itemId)
    if (!item) continue

    if (kind === 'memory') {
      const word = item.word.replace(/\s+/g, ' ').trim()
      if (word) push(item, word, item.meaning ?? undefined)
      continue
    }

    const before = out.length
    for (const raw of [...(item.phrases ?? []), ...(item.idioms ?? []), ...(item.usage ?? [])]) {
      if (out.length >= max) break
      const chunk = usableChunk(raw)
      if (chunk) push(item, chunk.en, chunk.zh)
    }
    if (out.length === before) {
      const word = item.word.replace(/\s+/g, ' ').trim()
      if (word && !CJK_RE.test(word)) push(item, word, item.meaning ?? undefined)
    }
  }

  return out.slice(0, max)
}

/** 一轮的稳定身份：同一组词 / 词块（顺序无关）落在同一条历史里。 */
export function drillSentenceId(kind: DrillSentenceKind, points: ReadonlyArray<DrillSentencePoint>): string {
  const signature = points
    .map((p) => keyOf(p.en))
    .sort()
    .join('|')
  let h = 5381
  for (let i = 0; i < signature.length; i++) h = ((h << 5) + h + signature.charCodeAt(i)) | 0
  return `drill:${kind}:${(h >>> 0).toString(36)}`
}

const KIND_LABEL: Record<DrillSentenceKind, string> = {
  memory: '记忆拷打',
  chunk: '词块拷打',
}

/** 记忆 / 词块拷打后的一句话题面；没有素材时返回 null（结算页不显示造句区）。 */
export function buildDrillSentenceItem(
  kind: DrillSentenceKind,
  points: ReadonlyArray<DrillSentencePoint>,
): GoldenExamItem | null {
  if (!points.length) return null
  const id = drillSentenceId(kind, points)
  const label = KIND_LABEL[kind]
  const unit = kind === 'chunk' ? '词块' : '单词'
  const list = points.map((p) => (p.zh ? `${p.en}（${p.zh}）` : p.en)).join('、')
  const rubric =
    kind === 'chunk'
      ? [
          { dimension: '词块使用', weight: 50, description: '每个词块是否完整、搭配是否正确' },
          { dimension: '语法准确', weight: 30, description: '时态、单复数、冠词、介词等硬错' },
          { dimension: '自然与连贯', weight: 20, description: '句子是否像真实英语，而不是逐词拼凑' },
        ]
      : [
          { dimension: '词义与搭配', weight: 40, description: '每个词是否用在正确的词义和自然搭配上' },
          { dimension: '语法准确', weight: 30, description: '时态、单复数、冠词、介词等硬错' },
          { dimension: '自然与连贯', weight: 30, description: '句子是否像真实英语，而不是逐词拼凑' },
        ]

  return {
    id,
    sentenceId: id,
    task: `用本轮${label}学过的这些${unit}写 1–3 句英文，全部用上：${list}。可以换主语或场景，不要照抄例句。`,
    // 本轮没有“范句”可模仿：留空，批改提示词只写「要求用上」。
    model: '',
    mustUse: points.map((p) => p.en),
    rubric,
    source: 'local',
  }
}

/** 结算页抬头用：记忆拷打 / 词块拷打。 */
export function drillSentenceKindLabel(kind: DrillSentenceKind): string {
  return KIND_LABEL[kind]
}
