import { useCallback } from 'react'
import type { DrillKind } from '../panels/IntensivePanel'
import type { QuizKind } from '../../core/quiz'
import type { IntensiveStageKey } from '../../core/intensive'

/**
 * 精读工作流面板上的两个入口动作 —— 「跳到对应工具」和「就地拷打一篇」。
 *
 * 从 `ReaderApp` 抽出来是因为**两张映射表都是规则**：
 *   - 阶段 → 工具：通读开速读、达标拷打开背单词、产出开仿写，
 *     其余（标词/词块/理解/语法）都交给一键跑批（它一次把音标·释义·例句·词组·习语·
 *     语法标记·翻译·语言点补齐）；
 *   - 拷打类型 → 考哪些题型：记忆 = 拼写/选义/选择，词块 = 用法/填空/搭配/介词/习语，
 *     深度 = 释义/释义选择，标词 = 标记，语法 = 走**文章级**测验（句子题，不写 SRS）。
 * 写歪了不会报错，只会「点了没反应」或「考错题」，所以放在一处、配测试。
 */
export interface IntensiveActionsDeps {
  /** 关掉面板（跳转前先收起来，免得盖住目标工具） */
  setIntensiveOpen: (open: boolean) => void
  openSpeedRead: () => void
  startStudy: () => void
  openWriting: () => void
  /** 一键跑批（补词/句/语言点） */
  runAiLocal: () => void
  /** 词级考试（按题型，写 SRS）；`scope` 省略 = 本篇 */
  startQuizDrill: (kinds: QuizKind[], scope?: 'article' | 'all') => void
  /** 文章级测验（句子题，不写 SRS） */
  startQuizArticleDrill: (kinds: QuizKind[]) => void
}

/** 拷打类型 → 题型（与 `startQuizDrill` 的 `QuizKind` 对齐，语法那档走文章级） */
const DRILL_KINDS: Record<DrillKind, QuizKind[]> = {
  memory: ['spell', 'meaning', 'choice'],
  chunk: ['usage', 'cloze', 'collocation', 'prep', 'idiom'],
  deep: ['define', 'defineChoice'],
  mark: ['mark'],
  grammar: ['grammar', 'phraseBlank', 'translate2', 'functionWord', 'ordering'],
  listen: ['listen'],
}

export function useIntensiveActions(deps: IntensiveActionsDeps) {
  const { setIntensiveOpen, openSpeedRead, startStudy, openWriting, runAiLocal, startQuizDrill, startQuizArticleDrill } = deps

  /** 某个阶段「跳到对应工具」 */
  const openIntensiveStage = useCallback(
    (key: IntensiveStageKey) => {
      setIntensiveOpen(false)
      if (key === 'skim') openSpeedRead()
      else if (key === 'recall') startStudy()
      else if (key === 'produce') openWriting()
      else void runAiLocal()
    },
    [setIntensiveOpen, openSpeedRead, startStudy, openWriting, runAiLocal],
  )

  /** 快捷「拷打」（只针对本篇） */
  const startIntensiveDrill = useCallback(
    (kind: DrillKind) => {
      setIntensiveOpen(false)
      const kinds = DRILL_KINDS[kind]
      if (kind === 'grammar') startQuizArticleDrill(kinds)
      else startQuizDrill(kinds, 'article')
    },
    [setIntensiveOpen, startQuizDrill, startQuizArticleDrill],
  )

  return { openIntensiveStage, startIntensiveDrill }
}
