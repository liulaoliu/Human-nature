/**
 * 记忆 / 词块拷打结束后的「用学过的内容造句」。
 *
 * 这里只做三件纯事：
 *   1. 每个考到的词条各取一个能直接写进英文句子的内容（记忆 = 单词，词块 = 词组 / 习语 / 英文用法）；
 *   2. 每个内容各拼一道 `GoldenExamItem`，让 `useGoldenImitation` 原样复用金句课本句仿写的批改链路；
 *   3. 中文用法笔记不当 `mustUse`（“so-called 常带保留态度”没法写进英文句子）。
 *
 * 为什么不是把所有词拼成一道题：不同词硬塞进同一句会变成“硬编”，
 * 每个考试内容独立一题才能真的练到“这个词怎么用”。
 *
 * 批改 / 解析 / 粘贴 / 历史全走 `useGoldenImitation` + `GoldenSentenceImitation`，不另写一套。
 */
import type { GoldenExamItem, VocabItem } from '../types/document'
import { splitGlossText } from './langPoints'
import type { QuizQuestion } from './quiz'

export type DrillSentenceKind = 'memory' | 'chunk'

export interface DrillSentenceOptions {
  /** 默认不截断；只有测试 / 特殊入口才需要限制。 */
  limit?: number
  /**
   * 本轮题目。词块拷打时用它把 itemId 精确对到「这场考试实际考的那条词块」；
   * 旧调用方不传就退回词条里的第一条可用词块。
   */
  questions?: ReadonlyArray<QuizQuestion>
}

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
 * **一条判分结果 = 一个考试内容 = 一个点**：
 * 记忆拷打取单词 + 词义；词块拷打按 phrases / idioms / 英文 usage 的顺序取
 * 第一条没被用过的词块，一个都取不到时退回单词本身。
 *
 * 同一词条考了多题只取第一次，避免同一个词重复出造句题；
 * 默认不截断，用户这轮考了几个内容就出几题。传 `limit` 只给测试 / 特殊入口用。
 */
export function drillSentencePoints(
  items: ReadonlyArray<VocabItem>,
  results: ReadonlyArray<{ id?: string; itemId: string }>,
  kind: DrillSentenceKind,
  options: DrillSentenceOptions = {},
): DrillSentencePoint[] {
  const byId = new Map(items.map((it) => [it.id, it]))
  const byQuestionId = new Map((options.questions ?? []).map((q) => [q.id, q]))
  const seenItems = new Set<string>()
  const seenText = new Set<string>()
  const out: DrillSentencePoint[] = []
  const limit = options.limit ?? Number.POSITIVE_INFINITY
  const max = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : Number.POSITIVE_INFINITY
  if (!max) return out

  /** 返回是否真的收下：重复文本会跳过，让词块继续试下一条。 */
  const push = (item: VocabItem, en: string, zh: string | undefined): boolean => {
    const key = keyOf(en)
    if (!key || seenText.has(key)) return false
    seenText.add(key)
    out.push({
      id: pointId(kind, item.id, en),
      itemId: item.id,
      en,
      ...(zh?.trim() ? { zh: zh.trim() } : {}),
    })
    return true
  }

  /** 词块题有完整 context 时，优先用这场考试实际考的那一条，而不是词条里的第一条。 */
  const testedChunk = (row: { id?: string; itemId: string }): { en: string; zh?: string } | null => {
    const question = row.id ? byQuestionId.get(row.id) : undefined
    if (!question) return null
    if (
      question.kind !== 'usage' &&
      question.kind !== 'idiom' &&
      question.kind !== 'prep' &&
      question.kind !== 'collocation'
    ) {
      return null
    }
    // 搭配默写的 context 是「chunk1；chunk2…」，题目答案只取第一条。
    const raw =
      question.kind === 'collocation'
        ? (question.context ?? '').split('；')[0] ?? ''
        : (question.context ?? '')
    return raw ? usableChunk(raw) : null
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

    const exact = testedChunk(row)
    let pickedChunk = !!(exact && push(item, exact.en, exact.zh))
    if (!pickedChunk) {
      for (const raw of [...(item.phrases ?? []), ...(item.idioms ?? []), ...(item.usage ?? [])]) {
        const chunk = usableChunk(raw)
        if (chunk && push(item, chunk.en, chunk.zh)) {
          pickedChunk = true
          break
        }
      }
    }
    if (!pickedChunk) {
      const word = item.word.replace(/\s+/g, ' ').trim()
      if (word && !CJK_RE.test(word)) push(item, word, item.meaning ?? undefined)
    }
  }

  return out
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

/** 一个考试内容一道题：题面只出现这一个词 / 词块，不再要求把多个词硬塞进同一句。 */
export function buildDrillSentenceItem(
  kind: DrillSentenceKind,
  point: DrillSentencePoint,
): GoldenExamItem {
  const id = drillSentenceId(kind, [point])
  const label = KIND_LABEL[kind]
  const unit = kind === 'chunk' ? '词块' : '单词'
  const target = point.zh ? `${point.en}（${point.zh}）` : point.en
  const rubric =
    kind === 'chunk'
      ? [
          { dimension: '词块使用', weight: 50, description: '词块是否完整、搭配是否正确' },
          { dimension: '语法准确', weight: 30, description: '时态、单复数、冠词、介词等硬错' },
          { dimension: '自然与连贯', weight: 20, description: '句子是否像真实英语，而不是逐词拼凑' },
        ]
      : [
          { dimension: '词义与搭配', weight: 40, description: '词是否用在正确的词义和自然搭配上' },
          { dimension: '语法准确', weight: 30, description: '时态、单复数、冠词、介词等硬错' },
          { dimension: '自然与连贯', weight: 30, description: '句子是否像真实英语，而不是逐词拼凑' },
        ]

  return {
    id,
    sentenceId: id,
    task: `用本轮${label}考过的这个${unit}写 1 句英文：${target}。可以换主语或场景，不要照抄例句；这一题只练这一个${unit}。`,
    // 本轮没有“范句”可模仿：留空，批改提示词只写「要求用上」。
    model: '',
    mustUse: [point.en],
    rubric,
    source: 'local',
  }
}

/** 每个点各一道题；结算页按这个数组逐题切换。 */
export function buildDrillSentenceItems(
  kind: DrillSentenceKind,
  points: ReadonlyArray<DrillSentencePoint>,
): GoldenExamItem[] {
  return points.map((point) => buildDrillSentenceItem(kind, point))
}

/** 结算页抬头用：记忆拷打 / 词块拷打。 */
export function drillSentenceKindLabel(kind: DrillSentenceKind): string {
  return KIND_LABEL[kind]
}
