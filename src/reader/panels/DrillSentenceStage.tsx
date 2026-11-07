import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { ActivityCat } from '../../core/activity'
import {
  buildDrillSentenceItems,
  drillSentenceKindLabel,
  drillSentencePoints,
  type DrillSentenceKind,
} from '../../core/drillSentence'
import type { QuizResultRow } from '../../core/sessionSnapshots'
import type { QuizQuestion } from '../../core/quiz'
import { removeWritingHistory } from '../../core/writingHistory'
import type { WritingRecord } from '../../core/writing'
import type { GoldenExamItem, VocabItem } from '../../types/document'
import { useGoldenImitation } from '../hooks/useGoldenImitation'
import GoldenSentenceImitation from './golden/GoldenSentenceImitation'
import WritingHistoryList from './WritingHistoryList'

export interface DrillSentenceStageProps {
  kind: DrillSentenceKind
  /** 整个词库：按本轮结果里的 itemId 反查词义 / 词块。 */
  items: VocabItem[]
  /** 本轮判分结果（记忆 / 词块拷打结算页已有）。 */
  results: QuizResultRow[]
  /** 本轮题目：词块拷打据此对到实际考过的那一条；旧调用不传就退回词条数据。 */
  questions?: QuizQuestion[]
  articleId: string
  articleTitle: string
  writingHistory: WritingRecord[]
  setWritingHistory: Dispatch<SetStateAction<WritingRecord[]>>
  flash: (message: string) => void
  recordActivity: (cat: ActivityCat, n?: number) => void
}

interface DrillSentenceTaskProps {
  task: GoldenExamItem
  index: number
  total: number
  kind: DrillSentenceKind
  articleId: string
  articleTitle: string
  writingHistory: WritingRecord[]
  setWritingHistory: Dispatch<SetStateAction<WritingRecord[]>>
  flash: (message: string) => void
  recordActivity: (cat: ActivityCat, n?: number) => void
}

/** 一道独立造句题：自己一份作答 / 批改状态，切题时不丢别的题。 */
function DrillSentenceTask({
  task,
  index,
  total,
  kind,
  articleId,
  articleTitle,
  writingHistory,
  setWritingHistory,
  flash,
  recordActivity,
}: DrillSentenceTaskProps) {
  const imitation = useGoldenImitation({
    current: task,
    articleId,
    articleTitle,
    source: 'drillSentence',
    setWritingHistory,
    writingHistory,
    flash,
    recordActivity,
  })
  const label = drillSentenceKindLabel(kind)
  const unit = kind === 'chunk' ? '词块' : '词'
  const focus = kind === 'chunk' ? '搭配、语法和自然度' : '词义、语法和自然度'
  const target = task.mustUse[0] ?? ''

  return (
    <GoldenSentenceImitation
      imitation={imitation}
      hint={`本轮${label}已考完。第 ${index + 1}/${total} 题：只用「${target}」写 1 句英文，AI 按${focus}批改；不用把别的${unit}硬塞进同一句。`}
    />
  )
}

/**
 * 记忆 / 词块拷打结算页的「用学过的内容造句」。
 *
 * **一条考试结果 = 一道独立造句题**：`core/drillSentence` 每个词 / 词块各拼一道题，
 * 这里用标签切换；每道题各自挂一个 `useGoldenImitation`，切走再切回来作答还在。
 * 作答、AI 批改、「复制提示词 → 粘回 JSON」、历史翻页仍复用金句课同一条链路。
 */
export default function DrillSentenceStage({
  kind,
  items,
  results,
  questions,
  articleId,
  articleTitle,
  writingHistory,
  setWritingHistory,
  flash,
  recordActivity,
}: DrillSentenceStageProps) {
  const points = useMemo(
    () => drillSentencePoints(items, results, kind, { questions }),
    [items, results, kind, questions],
  )
  const tasks = useMemo(() => buildDrillSentenceItems(kind, points), [kind, points])
  const [activeIndex, setActiveIndex] = useState(0)
  const [historyOpen, setHistoryOpen] = useState(false)
  const taskKey = tasks.map((task) => task.id).join('|')

  // 换一轮 / 换一批题时回到第一题；同一轮内写历史不会重置当前题。
  useEffect(() => {
    setActiveIndex(0)
  }, [taskKey])

  if (!tasks.length) return null

  const currentIndex = Math.min(activeIndex, tasks.length - 1)
  const unit = kind === 'chunk' ? '词块' : '词'
  return (
    <section className="drill-sentence">
      <div className="bar drill-sentence-head">
        <b>✍️ 用学过的内容造句</b>
        <span className="muted">
          共 {tasks.length} 题 · 每个{unit}独立一题 · 选做 · AI 批改 / 复制提示词手工批改
        </span>
        <button onClick={() => setHistoryOpen((v) => !v)} aria-expanded={historyOpen}>
          {historyOpen ? '收起造句历史' : '查看造句历史'}
        </button>
      </div>

      {tasks.length > 1 && (
        <div className="drill-sentence-switch" role="group" aria-label={`选择要造句的${unit}`}>
          {tasks.map((task, i) => (
            <button
              key={task.id}
              type="button"
              className={i === currentIndex ? 'on' : undefined}
              aria-pressed={i === currentIndex}
              title={task.task}
              onClick={() => setActiveIndex(i)}
            >
              {i + 1}. {task.mustUse[0]}
            </button>
          ))}
        </div>
      )}

      {tasks.map((task, i) => (
        <div key={task.id} className="drill-sentence-task" hidden={i !== currentIndex}>
          <DrillSentenceTask
            task={task}
            index={i}
            total={tasks.length}
            kind={kind}
            articleId={articleId}
            articleTitle={articleTitle}
            writingHistory={writingHistory}
            setWritingHistory={setWritingHistory}
            flash={flash}
            recordActivity={recordActivity}
          />
        </div>
      ))}

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
