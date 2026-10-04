import { useCallback, useEffect, useState } from 'react'
import { buildImitationTaskPrompt, buildWritingFeedbackPrompt, type ImitationTask, type WritingFeedback, type WritingRecord } from '../../core/writing'
import { useLocalStorageState } from './useLocalStorageState'

/** 仿写草稿（范句 / 作答 / 任务）持久化：刷新不丢。 */
function loadWritingDraft(): { model: string; text: string; task: ImitationTask | null } {
  try {
    const raw = localStorage.getItem('reader:writingDraft')
    const v = raw ? (JSON.parse(raw) as { model?: string; text?: string; task?: ImitationTask | null }) : null
    if (v && typeof v === 'object') return { model: v.model ?? '', text: v.text ?? '', task: v.task ?? null }
  } catch {
    // 忽略
  }
  return { model: '', text: '', task: null }
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
  const [feedback, setFeedback] = useState<WritingFeedback | null>(null)
  const [history, setHistory] = useLocalStorageState<WritingRecord[]>('reader:writingHistory', [])

  /** 打开仿写训练（范句默认用当前选中句）。 */
  const start = useCallback(() => {
    if (!doc || !doc.sentences.length) {
      flash('先打开一篇文章')
      return
    }
    const first = doc.sentences.find((s) => s.id === selectedId) ?? doc.sentences[0]
    closeOthers()
    setOpen(true)
    setModel(first.text)
    setTask(null)
    setText('')
    setFeedback(null)
  }, [doc, selectedId, flash, closeOthers])

  const copyImitationTask = useCallback(async () => {
    const m = model.trim()
    if (!m) {
      flash('先选一句范句')
      return
    }
    const s = doc?.sentences.find((x) => x.text === m)
    setLastTask('imitation')
    askedWordsRef.current = []
    askedIdsRef.current = []
    try {
      await navigator.clipboard.writeText(
        buildImitationTaskPrompt({ model: m, structure: s?.language?.structure, mustUse: s?.language?.phrases }),
      )
      flash('已复制仿写任务提示词；把 AI 的 JSON 粘回「应用结果」')
    } catch {
      flash('复制失败：浏览器需要 localhost 或 https')
    }
  }, [model, doc, flash, setLastTask, askedWordsRef, askedIdsRef])

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
      await navigator.clipboard.writeText(buildWritingFeedbackPrompt(task, text))
      flash('已复制批改提示词；把 AI 的 JSON 粘回「应用结果」')
    } catch {
      flash('复制失败：浏览器需要 localhost 或 https')
    }
  }, [task, text, flash, setLastTask, askedWordsRef, askedIdsRef])

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
      localStorage.setItem('reader:writingDraft', JSON.stringify({ model, text, task }))
    } catch {
      // 忽略
    }
  }, [model, text, task])

  return {
    open,
    setOpen,
    model,
    setModel,
    task,
    setTask,
    text,
    setText,
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
