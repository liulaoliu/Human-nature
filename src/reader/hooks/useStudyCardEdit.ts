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
    const next = {
      word: draft.word.trim() || card.word,
      phonetic: draft.phonetic.trim() || null,
      partOfSpeech: draft.partOfSpeech.trim() || null,
      meaning: draft.meaning.trim() || null,
      definition: draft.definition.trim() || null,
      usage: split(draft.usage),
      phrases: split(draft.phrases),
      idioms: split(draft.idioms),
      grammarMarks: split(draft.grammarMarks),
    }
    // **只提交真正改过的字段**：`editItem` 会把手上的每个字段都标成 manual，
    // 全都传一遍就等于「点一次保存、整条卡锁死」——词性没动也被锁，
    // 之后词典/AI 再也纠不了它（dwarf 卡上「n. 使相形见绌」就是这么冻住的）。
    const same = (a: readonly string[] | null | undefined, b: readonly string[] | null | undefined) =>
      (a ?? []).join('\u0001') === (b ?? []).join('\u0001')
    const patch: Partial<Omit<VocabItem, 'id' | 'lemma'>> = {}
    if (next.word !== card.word) patch.word = next.word
    if (next.phonetic !== (card.phonetic ?? null)) patch.phonetic = next.phonetic
    if (next.partOfSpeech !== (card.partOfSpeech ?? null)) patch.partOfSpeech = next.partOfSpeech
    if (next.meaning !== (card.meaning ?? null)) patch.meaning = next.meaning
    if (next.definition !== (card.definition ?? null)) patch.definition = next.definition
    if (!same(next.usage, card.usage)) patch.usage = next.usage
    if (!same(next.phrases, card.phrases)) patch.phrases = next.phrases
    if (!same(next.idioms, card.idioms)) patch.idioms = next.idioms
    if (!same(next.grammarMarks, card.grammarMarks)) patch.grammarMarks = next.grammarMarks
    if (!Object.keys(patch).length) {
      // 一个字都没改：不写库（否则凭空把 status 推到 edited、锁掉后续查词）
      setEditOpen(false)
      setDraft(null)
      flash('没有改动')
      return
    }
    persist(editItem(library, card.id, patch))
    setEditOpen(false)
    setDraft(null)
    flash('已保存修改')
  }, [card, draft, library, persist, flash])

  /** 取消编辑 = 关表单 + 丢草稿；两个状态一起收，避免只关一半。 */
  const cancelEdit = useCallback(() => {
    setEditOpen(false)
    setDraft(null)
  }, [])

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
    cancelEdit,
    removeCard,
  }
}
