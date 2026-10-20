import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import type { VocabItem, VocabLibrary } from '../../types/document'
import { editItem, removeItem } from '../../core/vocab'

/** 卡内编辑草稿。 */
export interface StudyDraft {
  word: string
  phonetic: string
  partOfSpeech: string
  meaning: string
  definition: string
  usage: string
  phrases: string
  idioms: string
  grammarMarks: string
}

export interface UseStudyCardEditOptions {
  card: VocabItem | null
  library: VocabLibrary
  queue: VocabItem[] | null
  index: number
  persist: (library: VocabLibrary) => void
  flash: (message: string) => void
  setQueue: Dispatch<SetStateAction<VocabItem[] | null>>
  setRoundTotal: Dispatch<SetStateAction<number>>
  setIndex: Dispatch<SetStateAction<number>>
  setRevealed: Dispatch<SetStateAction<boolean>>
  setInput: Dispatch<SetStateAction<string>>
  setChecked: Dispatch<SetStateAction<boolean>>
}

/**
 * 卡内维护：编辑（带出当前值、保存后状态置 edited）+ 两步确认删除（同步从本轮队列移除）。
 * 队列/进度的推进由调用方（会话 hook）负责，这里只按传入的 setter 调整。
 */
export function useStudyCardEdit({
  card,
  library,
  queue,
  index,
  persist,
  flash,
  setQueue,
  setRoundTotal,
  setIndex,
  setRevealed,
  setInput,
  setChecked,
}: UseStudyCardEditOptions) {
  const [editOpen, setEditOpen] = useState(false)
  const [draft, setDraft] = useState<StudyDraft | null>(null)
  const [delArmed, setDelArmed] = useState(false)

  /** 打开卡内编辑，带出当前值。 */
  const openEdit = useCallback(() => {
    if (!card) return
    setDraft({
      word: card.word,
      phonetic: card.phonetic ?? '',
      partOfSpeech: card.partOfSpeech ?? '',
      meaning: card.meaning ?? '',
      definition: card.definition ?? '',
      usage: card.usage.join('；'),
      phrases: (card.phrases ?? []).join('；'),
      idioms: (card.idioms ?? []).join('；'),
      grammarMarks: (card.grammarMarks ?? []).join('；'),
    })
    setEditOpen(true)
    setDelArmed(false)
  }, [card])

  /** 保存卡内编辑（持久化；状态置 edited，之后查词不会再覆盖）。 */
  const saveEdit = useCallback(() => {
    if (!card || !draft) return
    const split = (s: string) =>
      s
        .split(/[;；\n]/)
        .map((x) => x.trim())
        .filter(Boolean)
    persist(
      editItem(library, card.id, {
        word: draft.word.trim() || card.word,
        phonetic: draft.phonetic.trim() || null,
        partOfSpeech: draft.partOfSpeech.trim() || null,
        meaning: draft.meaning.trim() || null,
        definition: draft.definition.trim() || null,
        usage: split(draft.usage),
        phrases: split(draft.phrases),
        idioms: split(draft.idioms),
        grammarMarks: split(draft.grammarMarks),
      }),
    )
    setEditOpen(false)
    setDraft(null)
    flash('已保存修改')
  }, [card, draft, library, persist, flash])

  /** 卡内删除（两步确认），并从本轮队列里移除。 */
  const removeCard = useCallback(() => {
    if (!card) return
    if (!delArmed) {
      setDelArmed(true)
      window.setTimeout(() => setDelArmed(false), 3000)
      return
    }
    persist(removeItem(library, card.id))
    const removedBefore = queue ? queue.slice(0, index).filter((it) => it.id === card.id).length : 0
    setQueue((q) => (q ? q.filter((it) => it.id !== card.id) : q))
    setRoundTotal((t) => Math.max(0, t - 1))
    setIndex((i) => Math.max(0, i - removedBefore))
    setDelArmed(false)
    setEditOpen(false)
    setRevealed(false)
    setInput('')
    setChecked(false)
    flash('已删除')
  }, [card, delArmed, library, persist, queue, index, flash, setQueue, setRoundTotal, setIndex, setRevealed, setInput, setChecked])

  return {
    editOpen,
    setEditOpen,
    draft,
    setDraft,
    delArmed,
    setDelArmed,
    openEdit,
    saveEdit,
    removeCard,
  }
}
