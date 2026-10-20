import { useCallback, useMemo } from 'react'
import type { MutableRefObject } from 'react'
import type { VocabItem, VocabLibrary } from '../../types/document'
import type { ReaderDoc } from './useReaderDoc'
import { applyExamples, hasOwnExamples, removeItem } from '../../core/vocab'
import { removeArticleEntry } from '../../core/articleVocab'
import { collectOfflineExampleRows } from '../../core/libraryAutoFill'
import { loadTatoeba, tatoebaExamples } from '../../adapters/tatoeba'

export interface UseArticleUiActionsParams {
  flash: (message: string) => void
  confirmDel: string | null
  setConfirmDel: (id: string | null) => void
  confirmTimerRef: MutableRefObject<number | null>
  library: VocabLibrary
  persist: (library: VocabLibrary) => void
  speak: (text: string) => void
  speakRange: (text: string, start: number, end: number) => void
  speakNowPlaying: { text: string; ms: number; wordTimings: { start: number; end: number }[] } | null
  doc: ReaderDoc | null
  selectedId: string | null
  selectSentence: (sid: string) => void
  autoSpeak: boolean
  setSideTab: (tab: 'overview' | 'pick' | 'vocab' | 'stats' | 'mastery') => void
  focusEntry: (word: string) => void
  articleWords: VocabItem[]
  articleIdentity: string
  lookupTatoeba: (item: { word: string; lemma: string }) => { text: string; translation?: string }[]
}

/**
 * 正文上的轻量动作与派生：Alt 复制、两步删除、逐词高亮、点句朗读、
 * 生词定位、听写播放、离线例句补全。
 *
 * 都是「一句话就能说明白」的小动作，集中在这里避免 `ReaderApp` 被十几段
 * useCallback 切碎。
 */
export function useArticleUiActions({
  flash,
  confirmDel,
  setConfirmDel,
  confirmTimerRef,
  library,
  persist,
  speak,
  speakRange,
  speakNowPlaying,
  doc,
  selectedId,
  selectSentence,
  autoSpeak,
  setSideTab,
  focusEntry,
  articleWords,
  articleIdentity,
  lookupTatoeba,
}: UseArticleUiActionsParams) {
  /** 逐词高亮：当前朗读句 + 正读到的词下标。 */
  const karaoke = useMemo(() => {
    const np = speakNowPlaying
    if (!np || !doc) return null
    const s = doc.sentences.find((x) => x.text.trim() === np.text)
    if (!s) return null
    let activeIndex: number | null = null
    for (let i = 0; i < np.wordTimings.length; i++) {
      const wt = np.wordTimings[i]
      if (np.ms >= wt.start && np.ms < wt.end) {
        activeIndex = i
        break
      }
    }
    return { sid: s.id, activeIndex }
  }, [speakNowPlaying, doc])

  /** 按住 Alt 点句子：把文本复制到剪贴板（方便拿去翻译）。 */
  const altCopyText = useCallback(
    (text: string) => {
      const t = (text ?? '').trim()
      if (!t) return
      navigator.clipboard?.writeText(t).then(
        () => flash('已复制（Alt 点击）'),
        () => flash('复制失败：可按住 Alt 拖选后按 Ctrl+C'),
      )
    },
    [flash],
  )

  /** 删除词条：两步确认（第一次点变红「确认删除」，3 秒内再点才真删）。 */
  const askDelete = useCallback(
    (id: string) => {
      if (confirmDel === id) {
        persist(removeItem(library, id))
        setConfirmDel(null)
        if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current)
        return
      }
      setConfirmDel(id)
      if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current)
      confirmTimerRef.current = window.setTimeout(() => setConfirmDel(null), 3000)
    },
    [confirmDel, library, persist, setConfirmDel, confirmTimerRef],
  )

  /** 从本篇移出：只删这一篇的收录，全库词条与别的篇不受影响。 */
  const askDeleteArticle = useCallback(
    (id: string) => {
      if (confirmDel === id) {
        const item = library.items.find((it) => it.id === id)
        if (item) {
          persist(removeArticleEntry(library, articleIdentity, item.lemma))
          flash(`已从本篇移出：${item.word}（全库仍保留）`)
        }
        setConfirmDel(null)
        if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current)
        return
      }
      setConfirmDel(id)
      if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current)
      confirmTimerRef.current = window.setTimeout(() => setConfirmDel(null), 3000)
    },
    [confirmDel, library, articleIdentity, persist, flash, setConfirmDel, confirmTimerRef],
  )

  /** 点正文生词：先切到「生词本」Tab，再滚到对应词条。 */
  const revealVocabWord = useCallback(
    (word: string) => {
      setSideTab('vocab')
      focusEntry(word)
    },
    [focusEntry, setSideTab],
  )

  /** 听写播放：整句模式复用整句音频 + 逐词 seek；填空并段没有源句，直接播该块。 */
  const playDictItem = useCallback(
    (item: { text: string; src?: string; sw?: number; ew?: number }) => {
      if (item.src && item.sw != null && item.ew != null) speakRange(item.src, item.sw, item.ew)
      else speak(item.text)
    },
    [speak, speakRange],
  )

  /** 点句子：选中；开了「选中朗读」就在点击手势里直接读新句。 */
  const selectSentenceAndRead = useCallback(
    (sid: string) => {
      const wasSelected = selectedId === sid
      const s = doc?.sentences.find((x) => x.id === sid)
      selectSentence(sid)
      if (!wasSelected && autoSpeak && s && s.text.trim()) speak(s.text)
    },
    [selectedId, doc, selectSentence, autoSpeak, speak],
  )

  /** 一键：给「还没有自己例句」的本篇生词，批量补离线例句（Tatoeba）。 */
  const enrichExamplesFromTatoeba = useCallback(async () => {
    const ok = await loadTatoeba()
    if (!ok) {
      flash('离线例句未安装：先跑 `node tools/build-tatoeba.mjs <sentences.tsv> <links.tsv> cmn --en-only` 生成 public/tatoeba-en.tsv')
      return
    }
    const targets = articleWords.filter((it) => !hasOwnExamples(it))
    if (!targets.length) {
      flash('本篇生词都已经有例句了（只有「来源句」的会算缺）')
      return
    }
    let missing = 0
    for (const it of targets) if (!tatoebaExamples(it.word, it.lemma).length) missing++
    const rows = collectOfflineExampleRows(targets, lookupTatoeba)
    if (!rows.length) {
      flash(`离线例句库里有 ${missing} 个都查不到（可让 AI 补例句）`)
      return
    }
    persist(applyExamples(library, rows, new Date(), 'tatoeba'))
    flash(`已给 ${rows.length} 个词补上离线例句（Tatoeba）${missing ? `；${missing} 个库里没有` : ''}`)
  }, [articleWords, library, persist, flash, lookupTatoeba])

  return {
    karaoke,
    altCopyText,
    askDelete,
    askDeleteArticle,
    revealVocabWord,
    playDictItem,
    selectSentenceAndRead,
    enrichExamplesFromTatoeba,
  }
}
