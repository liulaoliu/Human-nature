import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { ActivityCat } from '../../core/activity'
import {
  buildDrillSentenceItem,
  drillSentenceKindLabel,
  drillSentencePoints,
  type DrillSentenceKind,
} from '../../core/drillSentence'
import type { QuizResultRow } from '../../core/sessionSnapshots'
import { removeWritingHistory } from '../../core/writingHistory'
import type { WritingRecord } from '../../core/writing'
import type { VocabItem } from '../../types/document'
import { useGoldenImitation } from '../hooks/useGoldenImitation'
import GoldenSentenceImitation from './golden/GoldenSentenceImitation'
import WritingHistoryList from './WritingHistoryList'

export interface DrillSentenceStageProps {
  kind: DrillSentenceKind
  /** 整个词库：按本轮结果里的 itemId 反查词义 / 词块。 */
  items: VocabItem[]
  /** 本轮判分结果（记忆 / 词块拷打结算页已有）。 */
  results: QuizResultRow[]
  articleId: string
  articleTitle: string
  writingHistory: WritingRecord[]
  setWritingHistory: Dispatch<SetStateAction<WritingRecord[]>>
  flash: (message: string) => void
  recordActivity: (cat: ActivityCat, n?: number) => void
}

/**
 * 记忆 / 词块拷打结算页的「用学过的内容造句」。
 *
 * 题目由 `core/drillSentence` 用本轮考到的词 / 词块拼出来；作答、AI 批改、
 * 「复制提示词 → 粘回 JSON」、历史翻页全部复用 `useGoldenImitation` +
 * `GoldenSentenceImitation`（和金句课本句仿写同一条链路），这里只做接线和抬头。
 */
export default function DrillSentenceStage({
  kind,
  items,
  results,
  articleId,
  articleTitle,
  writingHistory,
  setWritingHistory,
  flash,
  recordActivity,
}: DrillSentenceStageProps) {
  const points = useMemo(() => drillSentencePoints(items, results, kind), [items, results, kind])
  const current = useMemo(() => buildDrillSentenceItem(kind, points), [kind, points])
  const imitation = useGoldenImitation({
    current,
    articleId,
    articleTitle,
    source: 'drillSentence',
    setWritingHistory,
    writingHistory,
    flash,
    recordActivity,
  })
  const [historyOpen, setHistoryOpen] = useState(false)

  if (!current) return null

  const label = drillSentenceKindLabel(kind)
  const unit = kind === 'chunk' ? '词块' : '词'
  const focus = kind === 'chunk' ? '搭配、语法和自然度' : '词义、语法和自然度'
  return (
    <section className="drill-sentence">
      <div className="bar drill-sentence-head">
        <b>✍️ 用学过的内容造句</b>
        <span className="muted">选做 · AI 批改 / 复制提示词手工批改</span>
        <button onClick={() => setHistoryOpen((v) => !v)} aria-expanded={historyOpen}>
          {historyOpen ? '收起造句历史' : '查看造句历史'}
        </button>
      </div>
      <GoldenSentenceImitation
        imitation={imitation}
        hint={`本轮${label}已考完。现在把学到的${unit}用出来：写 1–3 句英文，全部用上下面这些${unit}；AI 会按${focus}批改。`}
      />
      {historyOpen && (
        <WritingHistoryList
          history={writingHistory}
          articleId={articleId}
          articleTitle={articleTitle}
          title="造句历史"
          initialSource="drillSentence"
          initialScope="article"
          onClear={(filter) => setWritingHistory((h) => removeWritingHistory(h, filter))}
        />
      )}
    </section>
  )
}
