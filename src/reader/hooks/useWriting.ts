import { useCallback, useEffect, useState } from 'react'
import { buildImitationTaskPrompt, buildWritingFeedbackPrompt, parseImitationTask, type ImitationTask, type WritingFeedback, type WritingRecord } from '../../core/writing'
import { getSentenceLanguages } from '../../core/language'
import { LEARNING_KEYS } from '../../core/learning'
import { useLocalStorageState } from './useLocalStorageState'

/** 仿写草稿（范句 / 作答 / 任务 / 必须用的词块）持久化：刷新不丢。 */
function loadWritingDraft(): { model: string; text: string; task: ImitationTask | null; mustUse: string[] } {
  const empty = { model: '', text: '', task: null as ImitationTask | null, mustUse: [] as string[] }
  try {
    const raw = localStorage.getItem('reader:writingDraft')
    if (!raw) return empty
    const v: unknown = JSON.parse(raw)
    if (!v || typeof v !== 'object') return empty
    const o = v as Record<string, unknown>
    // task 用 core 的严格解析重验一遍（手改/旧版本残留的形状不可信）
    const task = o.task ? parseImitationTask(JSON.stringify(o.task)) : null
    return {
      model: typeof o.model === 'string' ? o.model : '',
      text: typeof o.text === 'string' ? o.text : '',
      task,
      mustUse: Array.isArray(o.mustUse) ? o.mustUse.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [],
    }
  } catch {
    return empty
  }
}

export interface UseWritingParams {
  doc: { sentences: { id: string; text: string; language?: { structure?: string; phrases?: string[] } }[] } | null
  selectedId: string | null
  flash: (message: string) => void
  setLastTask: (task: 'imitation' | 'feedback') => void
  askedWordsRef: { current: string[] }
  askedIdsRef: { current: string[] }
  /** 打开仿写时关掉其它会话。 */
  closeOthers: () => void
}

/**
 * 仿写训练：范句 / 任务 / 作答 / AI 批改 / 历史 + 草稿持久化。
 */
export function useWriting({
  doc,
  selectedId,
  flash,
  setLastTask,
  askedWordsRef,
  askedIdsRef,
  closeOthers,
}: UseWritingParams) {
  const [open, setOpen] = useState(false)
  const [model, setModel] = useState(() => loadWritingDraft().model)
  const [task, setTask] = useState<ImitationTask | null>(() => loadWritingDraft().task)
  const [text, setText] = useState(() => loadWritingDraft().text)
  const [mustUse, setMustUse] = useState<string[]>(() => loadWritingDraft().mustUse)
  const [feedback, setFeedback] = useState<WritingFeedback | null>(null)
  const [history, setHistory] = useLocalStorageState<WritingRecord[]>(LEARNING_KEYS.writingHistory, [])

  /** 打开仿写训练（范句默认用当前选中句；也支持从金句课带 model + mustUse）。 */
  const start = useCallback(
    (opts?: { model?: string; mustUse?: string[] }) => {
      if (!doc || !doc.sentences.length) {
        flash('先打开一篇文章')
        return
      }
      const first = opts?.model?.trim()
        ? doc.sentences.find((s) => s.text === opts.model) ?? doc.sentences[0]
        : doc.sentences.find((s) => s.id === selectedId) ?? doc.sentences[0]
      closeOthers()
      setOpen(true)
      setModel(opts?.model?.trim() || first.text)
      setMustUse((opts?.mustUse ?? []).filter(Boolean))
      setTask(null)
      setText('')
      setFeedback(null)
    },
    [doc, selectedId, flash, closeOthers],
  )

  const copyImitationTask = useCallback(async () => {
    const m = model.trim()
    if (!m) {
      flash('先选一句范句')
      return
    }
    const s = doc?.sentences.find((x) => x.text === m)
    const first = s ? getSentenceLanguages(s)[0] : undefined
    const words = mustUse.length ? mustUse : first?.phrases
    setLastTask('imitation')
    askedWordsRef.current = []
    askedIdsRef.current = []
    try {
      await navigator.clipboard.writeText(
        buildImitationTaskPrompt({ model: m, structure: first?.structure, mustUse: words }),
      )
      flash('已复制仿写任务提示词；把 AI 的 JSON 粘回「应用结果」')
    } catch {
      flash('复制失败：浏览器需要 localhost 或 https')
    }
  }, [model, doc, mustUse, flash, setLastTask, askedWordsRef, askedIdsRef])

  const copyFeedback = useCallback(async () => {
    if (!task) {
      flash('先生成仿写任务')
      return
    }
    if (!text.trim()) {
      flash('先写点东西再批改')
      return
    }
    setLastTask('feedback')
    askedWordsRef.current = []
    askedIdsRef.current = []
    try {
      await navigator.clipboard.writeText(
        buildWritingFeedbackPrompt(task, text, {
          ...(task.round && task.round > 1 && feedback?.issues.length
            ? { previousIssues: feedback.issues }
            : {}),
        }),
      )
      flash('已复制批改提示词；把 AI 的 JSON 粘回「应用结果」')
    } catch {
      flash('复制失败：浏览器需要 localhost 或 https')
    }
  }, [task, text, feedback, flash, setLastTask, askedWordsRef, askedIdsRef])

  /** 载入一条历史记录回看。 */
  const loadRecord = useCallback((rec: WritingRecord) => {
    setModel(rec.model)
    setText(rec.text)
    setFeedback(rec.feedback)
    setTask(rec.task ?? null)
  }, [])

  // 仿写草稿（范句 / 作答 / 任务）持久化
  useEffect(() => {
    try {
      localStorage.setItem('reader:writingDraft', JSON.stringify({ model, text, task, mustUse }))
    } catch {
      // 忽略
    }
  }, [model, text, task, mustUse])

  return {
    open,
    setOpen,
    model,
    setModel,
    task,
    setTask,
    text,
    setText,
    mustUse,
    setMustUse,
    feedback,
    setFeedback,
    history,
    setHistory,
    start,
    copyImitationTask,
    copyFeedback,
    loadRecord,
  }
}
