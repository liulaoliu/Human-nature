import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { ActivityCat } from '../../core/activity'
import {
  buildDrillSentenceItems,
  drillSentenceId,
  drillSentenceKindLabel,
  drillSentencePoints,
  type DrillSentencePoint,
  type DrillSentenceKind,
} from '../../core/drillSentence'
import {
  loadDrillSentenceDraft,
  removeDrillSentenceDraft,
  saveDrillSentenceDraft,
  type DrillSentenceAnswerDraft,
} from '../../core/drillSentenceDraft'
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
  /** 这一题上次留下的作答（刷新 / 换题再回来都不丢）。 */
  saved?: DrillSentenceAnswerDraft
  onDraft: (taskId: string, draft: DrillSentenceAnswerDraft | null) => void
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
  saved,
  onDraft,
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

  // 上次写到一半的句子放回输入框（只放一次：之后由用户自己写）。
  const { setAnswer } = imitation
  useEffect(() => {
    if (saved?.answer) setAnswer(saved.answer)
    // 只在挂载 / 题面变化时回填，不让父组件每次重渲染都覆盖用户刚打的字
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id])

  return (
    <>
      <GoldenSentenceImitation
        imitation={imitation}
        hint={`本轮${label}已考完。第 ${index + 1}/${total} 题：只用「${target}」写 1 句英文，AI 按${focus}批改；不用把别的${unit}硬塞进同一句。`}
      />
      <div className="drill-sentence-actions">
        <button
          type="button"
          onClick={() =>
            onDraft(task.id, {
              answer: imitation.answer,
              round: imitation.round,
              at: new Date().toISOString(),
            })
          }
        >
          先存这一句
        </button>
        <button type="button" onClick={() => onDraft(task.id, null)}>
          清掉这一句的草稿
        </button>
      </div>
    </>
  )
}

/**
 * 记忆 / 词块拷打结算页的「用学过的内容造句」。
 *
 * **一条考试结果 = 一道独立造句题**：`core/drillSentence` 每个词 / 词块各拼一道题，
 * 这里用标签切换；每道题各自挂一个 `useGoldenImitation`，切走再切回来作答还在。
 * 作答与「停在第几题」另存一份本机草稿（`core/drillSentenceDraft`），刷新也不丢。
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
  /** 同一批题（顺序无关）算同一个草稿键：刷新后能认回自己的那一轮。 */
  const batchId = useMemo(
    () => drillSentenceId(kind, points as DrillSentencePoint[]),
    [kind, points],
  )
  const restored = useMemo(() => loadDrillSentenceDraft(batchId), [batchId])
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(0, Math.min(restored?.activeIndex ?? 0, Math.max(tasks.length - 1, 0))),
  )
  const [answers, setAnswers] = useState<Record<string, DrillSentenceAnswerDraft>>(
    () => restored?.answers ?? {},
  )
  const [historyOpen, setHistoryOpen] = useState(false)
  const taskKey = tasks.map((task) => task.id).join('|')
  /** 清空后别马上被自动保存写回去（等用户真动一下再存）。 */
  const skipSaveRef = useRef(false)

  // 换一批题才回到第一题；同一批（刷新 / 重渲染）由上面 restored 决定停在第几题。
  const firstTaskKeyRef = useRef(taskKey)
  useEffect(() => {
    if (firstTaskKeyRef.current === taskKey) return
    firstTaskKeyRef.current = taskKey
    setActiveIndex(0)
  }, [taskKey])

  // 停在哪一题、每题写到哪，都随写随存（不必用户手动点）。
  useEffect(() => {
    if (!tasks.length) return
    if (skipSaveRef.current) {
      skipSaveRef.current = false
      return
    }
    saveDrillSentenceDraft({
      batchId,
      activeIndex: Math.min(activeIndex, tasks.length - 1),
      answers,
      at: new Date().toISOString(),
    })
  }, [batchId, activeIndex, answers, tasks.length])

  const onDraft = useCallback(
    (taskId: string, draft: DrillSentenceAnswerDraft | null) => {
      setAnswers((prev) => {
        if (!draft) {
          const next = { ...prev }
          delete next[taskId]
          return next
        }
        if (!draft.answer.trim()) return prev
        return { ...prev, [taskId]: draft }
      })
    },
    [],
  )

  const clearBatch = useCallback(() => {
    skipSaveRef.current = true
    removeDrillSentenceDraft(batchId)
    setAnswers({})
    setActiveIndex(0)
  }, [batchId])

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
              {answers[task.id] ? <span className="drill-sentence-dot" aria-label="有草稿" /> : null}
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
            saved={answers[task.id]}
            onDraft={onDraft}
          />
        </div>
      ))}

      {historyOpen && (
        <>
          <div className="bar">
            <span className="muted">这一轮造句的作答会留着；想从头再来可以清掉。</span>
            <button type="button" onClick={clearBatch}>
              清空这一轮造句草稿
            </button>
          </div>
          <WritingHistoryList
            history={writingHistory}
            articleId={articleId}
            articleTitle={articleTitle}
            title="造句历史"
            initialSource="drillSentence"
            initialScope="article"
            onClear={(filter) => setWritingHistory((h) => removeWritingHistory(h, filter))}
          />
        </>
      )}
    </section>
  )
}
