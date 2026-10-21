import type {
  VocabField,
  VocabFieldSource,
  VocabFieldSources,
  VocabItem,
} from '../types/document'

/**
 * 词条核心字段来源（唯一事实来源）。
 *
 * 字段：音标 / 词性 / 中文释义 / 英英释义。
 * 写入方：AI 查词、离线词典（ECDICT / M-W）、手动编辑。
 *
 * 旧数据没有 `fieldSources`：仍按 `status === 'edited' / 'mastered'` 整条锁，
 * 但不假装知道具体来源。
 */
export const VOCAB_FIELDS = ['phonetic', 'partOfSpeech', 'meaning', 'definition'] as const

export const VOCAB_FIELD_SOURCES = ['ai', 'dict', 'manual'] as const

const FIELDS = new Set<string>(VOCAB_FIELDS)
const SOURCES = new Set<string>(VOCAB_FIELD_SOURCES)

export function isVocabField(value: unknown): value is VocabField {
  return typeof value === 'string' && FIELDS.has(value)
}

export function isVocabFieldSource(value: unknown): value is VocabFieldSource {
  return typeof value === 'string' && SOURCES.has(value)
}

/** 外部输入（备份 JSON / localStorage）里的字段来源先过这里。 */
export function normalizeVocabFieldSources(value: unknown): VocabFieldSources | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const out: VocabFieldSources = {}
  for (const field of VOCAB_FIELDS) {
    if (isVocabFieldSource(raw[field])) out[field] = raw[field]
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * 这个字段是否禁止自动覆盖。
 *
 * - 新数据：只看该字段有没有被手动改过（`fieldSources[field] === 'manual'`）；
 * - 旧数据没有 `fieldSources`：保持原行为，edited / mastered 整条锁；
 * - mastered 始终整条锁（用户已明确掌握，不让自动结果改词义）。
 */
export function isFieldLocked(item: VocabItem, field: VocabField): boolean {
  if (item.status === 'mastered') return true
  if (item.fieldSources) return item.fieldSources[field] === 'manual'
  return item.status === 'edited'
}

/** 界面标签；没有记录来源时返回空串。 */
export function fieldSourceLabel(source: VocabFieldSource | undefined): string {
  return source === 'ai' ? 'AI' : source === 'dict' ? '词典' : source === 'manual' ? '手动' : ''
}
