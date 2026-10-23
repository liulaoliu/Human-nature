import { useCallback } from 'react'
import type { DrillKind } from '../panels/IntensivePanel'
import type { QuizKind } from '../../core/quiz'
import type { IntensiveStageKey } from '../../core/intensive'

/**
 * 精读工作流面板上的两个入口动作 —— 「跳到对应工具」和「就地拷打一篇」。
 *
 * 从 `ReaderApp` 抽出来是因为**两张映射表都是规则**：
 *   - 阶段 → 工具：通读开速读、达标拷打开背单词、产出开仿写、**语法开文章级测验**
 *     （这一步的字面意思就是「练」，不是补数据）；
 *     其余（标词/词块/理解）交给一键跑批（它一次把音标·释义·例句·词组·习语·
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
  startQuizDrill: (kinds: QuizKind[], scope?: 'article' | 'all', opts?: { warmup?: 'memory' | 'chunk' }) => void
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
      // 标词 / 词块 / 理解三档是「就地跑批」——面板留着不关，跑批进度、第几轮、
      // 「取消」都在眼前。关掉再跑，用户只能等一句 flash，看起来就像「点了没反应」。
      if (key === 'vocab' || key === 'chunks' || key === 'comprehend') {
        void runAiLocal()
        return
      }
      setIntensiveOpen(false)
      if (key === 'skim') openSpeedRead()
      else if (key === 'recall') startStudy()
      else if (key === 'produce') openWriting()
      // 语法专项的按钮写着「练结构 / 语法」，就该去练：和「快速拷打 → 语法」同一套文章级题型
      //（句子题，不写 SRS）。之前这里落到 `runAiLocal()`，点下去只是补语言点，等于没练。
      else if (key === 'grammar') startQuizArticleDrill(DRILL_KINDS.grammar)
    },
    [setIntensiveOpen, openSpeedRead, startStudy, openWriting, runAiLocal, startQuizArticleDrill],
  )

  /** 快捷「拷打」（只针对本篇） */
  const startIntensiveDrill = useCallback(
    (kind: DrillKind) => {
      setIntensiveOpen(false)
      const kinds = DRILL_KINDS[kind]
      if (kind === 'grammar') startQuizArticleDrill(kinds)
      // 记忆 / 词块两档是闭卷回忆：先摊开这轮要考的词（词 + 释义 / 词块）再开考。
      // 直接上来就考，第一次见的词只能靠猜 —— 猜错还会被当成「没记住」记进错题本。
      else if (kind === 'memory' || kind === 'chunk') startQuizDrill(kinds, 'article', { warmup: kind })
      else startQuizDrill(kinds, 'article')
    },
    [setIntensiveOpen, startQuizDrill, startQuizArticleDrill],
  )

  return { openIntensiveStage, startIntensiveDrill }
}
