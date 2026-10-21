import type { VocabConfusableSource } from '../types/document'

/**
 * 易混项来源（唯一事实来源）。
 *
 * 易混项现在有两个写入方：
 *   - ai：AI 混淆项任务（`core/aiApply.ts`）
 *   - dict：离线词典按拼写近邻生成（`hooks/useDictTools.ts`）
 *
 * 旧数据没有 `confusablesSource`，按「未记录」处理，不根据内容或时间反推。
 */
export const VOCAB_CONFUSABLE_SOURCES = ['ai', 'dict'] as const

const SOURCES = new Set<string>(VOCAB_CONFUSABLE_SOURCES)

/** 外部输入（备份 JSON / localStorage）里的易混项来源先过这里。 */
export function isVocabConfusableSource(value: unknown): value is VocabConfusableSource {
  return typeof value === 'string' && SOURCES.has(value)
}

/** 界面标签；旧数据返回空串（不显示来源）。 */
export function confusableSourceLabel(source: VocabConfusableSource | undefined): string {
  return source === 'ai' ? 'AI' : source === 'dict' ? '词典' : ''
}
