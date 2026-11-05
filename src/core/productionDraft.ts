import {
  type ProductionMode,
  type ProductionPrompt,
  type ProductionTarget,
  type ProductionTargetHit,
  type ProductionTargetKind,
} from './production'
import type { WritingFeedback } from './writing'

/**
 * 奶牛工棚的**会话草稿**（当前这一组没提交的作答）。
 *
 * 这是本机偏好/会话状态，不进学习记录；真正的提交稿仍在 writingHistory。
 * 刷新 / 关页面后能恢复当前题号、题干、草稿、批改和命中，避免长段落白写。
 */

export const PRODUCTION_DRAFT_KEY = 'reader:productionDraft'
const VERSION = 1
const MAX_PROMPTS = 60

export interface ProductionDraft {
  version: 1
  sessionId: string
  articleId: string
  at: string
  mode: ProductionMode
  sessionTopic: string
  prompts: ProductionPrompt[]
  index: number
  answer: string
  feedback: WritingFeedback | null
  previousFeedback: WritingFeedback | null
  hits: ProductionTargetHit[]
  round: number
  notice: string
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function asString(v: unknown, max = 5000): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

function normalizeTarget(v: unknown): ProductionTarget | null {
  if (!isObject(v)) return null
  const kind = v.kind
  if (kind !== 'word' && kind !== 'phrase' && kind !== 'idiom') return null
  const text = asString(v.text, 300).trim()
  if (!text) return null
  return {
    id: asString(v.id, 200) || `${asString(v.itemId, 200)}|${kind}|draft`,
    itemId: asString(v.itemId, 200),
    kind: kind as ProductionTargetKind,
    text,
    meaning: asString(v.meaning, 300),
  }
}

function normalizeHit(v: unknown): ProductionTargetHit | null {
  if (!isObject(v)) return null
  const kind = v.kind
  if (kind !== 'word' && kind !== 'phrase' && kind !== 'idiom') return null
  const text = asString(v.text, 300).trim()
  if (!text) return null
  return {
    id: asString(v.id, 200) || `${kind}:${text}`,
    kind: kind as ProductionTargetKind,
    text,
    meaning: asString(v.meaning, 300),
    used: v.used === true,
  }
}

function normalizePrompt(v: unknown): ProductionPrompt | null {
  if (!isObject(v)) return null
  const zh = asString(v.zh, 2000).trim()
  if (!zh) return null
  const targets = Array.isArray(v.targets)
    ? v.targets.map(normalizeTarget).filter((t): t is ProductionTarget => !!t)
    : []
  return {
    id: asString(v.id, 200) || `draft-${zh.slice(0, 8)}`,
    zh,
    goal: asString(v.goal, 500),
    targets,
    ...(typeof v.reference === 'string' ? { reference: asString(v.reference, 5000) } : {}),
    ...(v.answerLang === 'zh' ? { answerLang: 'zh' as const } : {}),
    ...(typeof v.model === 'string' && asString(v.model, 1500) ? { model: asString(v.model, 1500) } : {}),
  }
}

function normalizeFeedback(v: unknown): WritingFeedback | null {
  if (!isObject(v)) return null
  if (v.version !== 2) return null
  if (!Array.isArray(v.scores) || !Array.isArray(v.issues)) return null
  const total = Number(v.total)
  const max = Number(v.max)
  if (!Number.isFinite(total) || !Number.isFinite(max)) return null
  return v as unknown as WritingFeedback
}

export function normalizeProductionDraft(raw: unknown, articleId?: string): ProductionDraft | null {
  if (!isObject(raw) || raw.version !== VERSION) return null
  const prompts = Array.isArray(raw.prompts)
    ? raw.prompts
        .slice(0, MAX_PROMPTS)
        .map(normalizePrompt)
        .filter((p): p is ProductionPrompt => !!p)
    : []
  if (!prompts.length) return null
  const mode = raw.mode
  if (mode !== 'full' && mode !== 'skim' && mode !== 'yogurt') return null
  const id = asString(raw.articleId, 300) || 'manual'
  if (articleId !== undefined && id !== articleId) return null
  const seen = new Set<string>()
  const hits = Array.isArray(raw.hits)
    ? raw.hits.map(normalizeHit).filter((h): h is ProductionTargetHit => {
        if (!h) return false
        if (seen.has(h.id)) return false
        seen.add(h.id)
        return true
      })
    : []
  const index = Math.max(0, Math.min(prompts.length - 1, Math.floor(Number(raw.index) || 0)))
  return {
    version: 1,
    sessionId: asString(raw.sessionId, 200),
    articleId: id,
    at: asString(raw.at, 100) || new Date().toISOString(),
    mode,
    sessionTopic: asString(raw.sessionTopic, 300),
    prompts,
    index,
    answer: asString(raw.answer, 50_000),
    feedback: normalizeFeedback(raw.feedback),
    previousFeedback: normalizeFeedback(raw.previousFeedback),
    hits,
    round: Number(raw.round) >= 2 ? 2 : 1,
    notice: asString(raw.notice, 2000),
  }
}
