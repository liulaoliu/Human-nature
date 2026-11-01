import type { VocabItem, VocabLibrary } from '../../types/document'
import { canQuizMeaning, isRelearning, needsMeaningCheck } from './review'

export interface StudyCardViewParams {
  library: VocabLibrary
  queue: VocabItem[] | null
  index: number
  /** 本轮总数（进度分母）；加练卡从它之后开始。 */
  roundTotal: number
  /** 收尾「重练忘记的」：标过不认识的词也要先选释义。 */
  retrying: boolean
  /** 本卡是否已经通过「选中文释义」这一关。 */
  meaningCleared: boolean
  /** 组末拼写测试的当前词；非空时整页显示它。 */
  roundCard?: VocabItem | null
}

export interface StudyCardView {
  card: VocabItem | null
  /** 忘记 / 模糊后被追加到队尾的加练卡。 */
  isExtraCard: boolean
  relearning: boolean
  meaningRequired: boolean
  meaningGate: boolean
}

/**
 * 当前卡与两道门禁的派生（纯函数）。
 *
 * 优先取词库最新（评分 / 编辑后立刻反映），队列快照兜底；组末拼写测试时换成测试里的词。
 * 规则本身都在 `review.ts`，这里只负责「先看谁、再套哪条」。
 */
export function studyCardView({
  library,
  queue,
  index,
  roundTotal,
  retrying,
  meaningCleared,
  roundCard,
}: StudyCardViewParams): StudyCardView {
  const card =
    roundCard ??
    (queue && index < queue.length
      ? (library.items.find((it) => it.id === queue[index].id) ?? queue[index])
      : null)
  const isExtraCard = !!queue && roundTotal > 0 && index >= roundTotal
  const relearning = !!card && isRelearning(card)
  const meaningRequired =
    !!card &&
    !relearning &&
    needsMeaningCheck(card, { extra: isExtraCard, retrying }) &&
    canQuizMeaning(card, library.items)
  return {
    card,
    isExtraCard,
    relearning,
    meaningRequired,
    meaningGate: meaningRequired && !meaningCleared,
  }
}
