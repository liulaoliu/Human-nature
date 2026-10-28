import { useCallback, useMemo, useRef, useState } from 'react'
import {
  buildGoldenAssembly,
  buildGoldenFillPlan,
  checkGoldenAssembly,
  checkGoldenFill,
  goldenFillAllCorrect,
} from '../../core/goldenDrill'
import { emptyGoldenRecord, recordGoldenStep, type GoldenDrillRecord } from '../../core/goldenProgress'
import type { AnswerEventInput } from '../../core/answerEvents'
import type { GoldenLesson, GoldenSentence, GoldenTarget, Sentence } from '../../types/document'
import type { GoldenPhase } from './goldenSession'

export interface UseGoldenFillAssembleParams {
  lesson: GoldenLesson | null
  /** 金句课里的当前句（含目标/中文提示）。 */
  current: GoldenSentence | null
  /** 正文里的当前句（判分用原文）。 */
  currentSentence: Sentence | null
  targets: GoldenTarget[]
  drillKey: string
  currentRecord: GoldenDrillRecord | null
  articleId: string
  articleTitle: string
  recordGolden: (record: GoldenDrillRecord) => void
  recordAnswer?: (event: AnswerEventInput) => void
  setPhase: (phase: GoldenPhase) => void
}

/**
 * 金句课的「填空 + 拼句」练习状态机。
 *
 * 只负责当前句的轮次、输入、判分与写回；选句/会话视图仍在 useGoldenDrill。
 * 这样主 hook 只剩编排，新增填空/拼句规则时也不会继续把它撑大。
 */
export function useGoldenFillAssemble({
  lesson,
  current,
  currentSentence,
  targets,
  drillKey,
  currentRecord,
  articleId,
  articleTitle,
  recordGolden,
  recordAnswer,
  setPhase,
}: UseGoldenFillAssembleParams) {
  const [fillInputs, setFillInputs] = useState<string[]>([])
  const [fillChecked, setFillChecked] = useState<boolean[] | null>(null)
  const [fillCorrect, setFillCorrect] = useState<boolean | null>(null)
  const [fillRound, setFillRound] = useState(0)
  const [fillRoundPassed, setFillRoundPassed] = useState(false)
  const fillEverWrongRef = useRef(false)
  const [assembleOrder, setAssembleOrder] = useState<string[]>([])
  const [assembleChecked, setAssembleChecked] = useState<boolean | null>(null)

  const blankUnit = lesson?.options?.blankUnit ?? 'word'
  const sentenceFill = lesson?.options?.sentenceFill !== false
  const fillRounds = useMemo(
    () =>
      currentSentence
        ? buildGoldenFillPlan(currentSentence.text, targets, { blankUnit, sentenceFill })
        : [],
    [currentSentence, targets, blankUnit, sentenceFill],
  )
  const fillRoundCount = fillRounds.length
  const currentFillRound = fillRounds[Math.min(fillRound, Math.max(0, fillRoundCount - 1))] ?? null
  const cloze = currentFillRound?.cloze ?? null
  const assembly = useMemo(
    () => (currentSentence ? buildGoldenAssembly(currentSentence.text, targets) : null),
    [currentSentence, targets],
  )

  /** 清空本句的临时作答；换句 / 重练 / 重新打开都走这一处。 */
  const resetFillAssemble = useCallback(() => {
    setFillInputs([])
    setFillChecked(null)
    setFillCorrect(null)
    setFillRound(0)
    setFillRoundPassed(false)
    fillEverWrongRef.current = false
    setAssembleOrder([])
    setAssembleChecked(null)
  }, [])

  const beginFill = useCallback(() => {
    setPhase('fill')
    setFillRound(0)
    setFillRoundPassed(false)
    fillEverWrongRef.current = false
    setFillInputs([])
    setFillChecked(null)
    setFillCorrect(null)
  }, [setPhase])

  const checkFill = useCallback(() => {
    if (!cloze || !currentSentence || !current || !drillKey) return
    // 本组已通过或已到最后一步时，Enter 属于「继续下一组 / 拼接整句」，不再重复检查。
    if (fillRoundPassed || fillCorrect === true) return
    const results = checkGoldenFill(cloze, fillInputs)
    const ok = goldenFillAllCorrect(results)
    setFillChecked(results)
    recordAnswer?.({
      articleId,
      source: 'golden',
      kind: 'fill',
      cat: 'write',
      correct: ok,
      questionId: `${current.id}:fill:${fillRound}`,
    })
    if (!ok) {
      fillEverWrongRef.current = true
      setFillRoundPassed(false)
      setFillCorrect(false)
      return
    }
    if (fillRound + 1 < fillRoundCount) {
      setFillRoundPassed(true)
      setFillCorrect(null)
      return
    }
    setFillRoundPassed(false)
    setFillCorrect(true)
    const base =
      currentRecord ??
      emptyGoldenRecord(articleId, articleTitle, current.id, drillKey, new Date().toISOString())
    const next = recordGoldenStep(base, 'fill', !fillEverWrongRef.current, new Date().toISOString())
    recordGolden(next)
  }, [
    cloze,
    currentSentence,
    current,
    drillKey,
    fillInputs,
    fillRound,
    fillRoundCount,
    fillRoundPassed,
    fillCorrect,
    currentRecord,
    articleId,
    articleTitle,
    recordGolden,
    recordAnswer,
  ])

  const nextFillRound = useCallback(() => {
    if (fillRound + 1 >= fillRoundCount) return
    setFillRound((r) => r + 1)
    setFillRoundPassed(false)
    setFillInputs([])
    setFillChecked(null)
    setFillCorrect(null)
  }, [fillRound, fillRoundCount])

  const beginAssemble = useCallback(() => {
    setPhase('assemble')
    setAssembleOrder([])
    setAssembleChecked(null)
  }, [setPhase])

  const checkAssemble = useCallback(() => {
    if (!assembly || !currentSentence || !current || !drillKey) return
    const ok = checkGoldenAssembly(assembly.cloze.targets, assembleOrder)
    setAssembleChecked(ok)
    const base =
      currentRecord ??
      emptyGoldenRecord(articleId, articleTitle, current.id, drillKey, new Date().toISOString())
    recordGolden(recordGoldenStep(base, 'assemble', ok, new Date().toISOString()))
    recordAnswer?.({
      articleId,
      source: 'golden',
      kind: 'assemble',
      cat: 'write',
      correct: ok,
      questionId: `${current.id}:assemble`,
    })
  }, [
    assembly,
    currentSentence,
    current,
    drillKey,
    assembleOrder,
    currentRecord,
    articleId,
    articleTitle,
    recordGolden,
    recordAnswer,
  ])

  return {
    blankUnit,
    sentenceFill,
    fillRoundCount,
    cloze,
    assembly,
    fillInputs,
    setFillInputs,
    fillChecked,
    fillCorrect,
    fillRound,
    fillRoundPassed,
    beginFill,
    checkFill,
    nextFillRound,
    assembleOrder,
    setAssembleOrder,
    assembleChecked,
    beginAssemble,
    checkAssemble,
    resetFillAssemble,
  }
}
