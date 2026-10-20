import type { VocabVia } from '../types/document'

/**
 * 本篇生词的细分来源（唯一事实来源）。
 *
 * `origin` 仍保留粗粒度 auto/manual（老数据、打印口径都在用）；
 * `via` 只负责回答「这个词是怎么进来的」：
 *   - ai：AI 自动标词直入
 *   - dict：离线词典挑词 / 一键处理
 *   - manual：手动点选、速读里手动加词
 *   - language：AI 语言点自动收藏
 *   - auto：听写等自动补词
 *   - batch / legacy：旧数据没记具体来源，只知道自己不是逐个点的
 */
export const VOCAB_VIAS = ['ai', 'dict', 'manual', 'language', 'auto', 'batch', 'legacy'] as const

const VIAS = new Set<string>(VOCAB_VIAS)

/** 外部输入（localStorage / 备份 JSON）里的来源字段先过这里。 */
export function isVocabVia(value: unknown): value is VocabVia {
  return typeof value === 'string' && VIAS.has(value)
}
