import { useRef, useState } from 'react'
import type { AnalysisTask } from '../../core/analyzer'
import type { GoldenLesson, Paragraph, Sentence } from '../../types/document'
import type { ApplyOutcome } from './useApplyTaskResult'

/**
 * 阅读页的「本机组装状态」。
 *
 * 这些 state 只在本页内用：谁打开/关闭、粘回的 AI 文本、当前高亮/气泡位置。
 * 抽出来不是造抽象，而是让 `ReaderApp` 这个组合根别再被一堆 useState 撑到 800 行门禁线上。
 */

export interface ReaderDoc {
  paragraphs: Paragraph[]
  sentences: Sentence[]
  golden?: GoldenLesson
}

export type PasteTaskKind =
  | AnalysisTask
  | 'confusable'
  | 'example'
  | 'phrase'
  | 'lemma'
  | 'pos'
  | 'grammar_mark'
  | 'listening'
  | 'language'
  | 'golden'
  | 'imitation'
  | 'feedback'

/** AI 粘回框 / 上次任务 / 回执 / 缺失项。 */
export function usePasteState() {
  const [pasted, setPasted] = useState('')
  /** 上次「复制提示词」请求的词（用于校验 AI 返回是否齐全） */
  const askedWordsRef = useRef<string[]>([])
  /** 上次「全文翻译」请求的句子 id（用于校验是否逐句返回） */
  const askedIdsRef = useRef<string[]>([])
  /** 上次请求所属文章（至少金句课用它防止切篇后粘错）。 */
  const askedArticleKeyRef = useRef<string | null>(null)
  /** 应用结果后的回执（成功 / 缺失 / 无效） */
  const [pasteReport, setPasteReport] = useState<string[]>([])
  /** 上次回执里缺失的词（用于「一键复制未返回的」重试）；类型跟着 hook 走，别再抄一份联合 */
  const [pasteMissing, setPasteMissing] = useState<ApplyOutcome['missing']>(null)
  const [lastTask, setLastTask] = useState<PasteTaskKind | null>(null)

  return {
    pasted,
    setPasted,
    askedWordsRef,
    askedIdsRef,
    askedArticleKeyRef,
    pasteReport,
    setPasteReport,
    pasteMissing,
    setPasteMissing,
    lastTask,
    setLastTask,
  }
}

/** 正文高亮 / 选词气泡 / 两步删除的临时状态。 */
export function useReaderHighlightState() {
  /** a/d 临时提示的句子（有生词，底色与“选中句”略不同） */
  const [peekSid, setPeekSid] = useState<string | null>(null)
  /** 生词本里被高亮/滚到的词条（点正文生词时用） */
  const [focusLemma, setFocusLemma] = useState<string | null>(null)
  /** 待确认删除的词条 id（两步防误触） */
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  /** 选词模式：最近选中的词 + 气泡位置 */
  const [lastPicked, setLastPicked] = useState<{ word: string; sid: string } | null>(null)
  const [bubblePos, setBubblePos] = useState<{ top: number; left: number } | null>(null)

  return {
    peekSid,
    setPeekSid,
    focusLemma,
    setFocusLemma,
    confirmDel,
    setConfirmDel,
    lastPicked,
    setLastPicked,
    bubblePos,
    setBubblePos,
  }
}

/** 当前文章 / 正文 / 句内选区 / 标题 / 已保存 id / 删除确认。 */
export function useArticleDocState() {
  const [articleKey, setArticleKey] = useState<string | null>(null)
  const [doc, setDoc] = useState<ReaderDoc | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** 鼠标精确选中的片段（划选 / 双击选词），可能为空 */
  const [exact, setExact] = useState('')
  /** 是否用精确片段：有精确选区时为真，默认用整句 */
  const [useExact, setUseExact] = useState(false)
  /** 精确选区：哪个句子 + 哪些词（可离散，支持下划线多选） */
  const [selSid, setSelSid] = useState<string | null>(null)
  const [selIndices, setSelIndices] = useState<number[]>([])
  const [articleTitle, setArticleTitle] = useState('')
  const [savedId, setSavedId] = useState<string | null>(null)
  /** 「删除保存」文章的两步确认 */
  const [confirmDelSave, setConfirmDelSave] = useState(false)

  return {
    articleKey,
    setArticleKey,
    doc,
    setDoc,
    selectedId,
    setSelectedId,
    exact,
    setExact,
    useExact,
    setUseExact,
    selSid,
    setSelSid,
    selIndices,
    setSelIndices,
    articleTitle,
    setArticleTitle,
    savedId,
    setSavedId,
    confirmDelSave,
    setConfirmDelSave,
  }
}
