import type { GoldenPhase, GoldenView } from './useGoldenDrill'
import { hasModifier, isComposing, isEditableTarget } from '../hotkeys'
import { useHotkeys } from '../useHotkeys'

export interface GoldenHotkeyContext {
  open: boolean
  view: GoldenView
  phase: GoldenPhase
  hasCloze: boolean
  hasAssembly: boolean
  fillCorrect: boolean | null
  fillRoundPassed: boolean
  assembleChecked: boolean | null
  assembleOrderLength: number
  assembleTargetCount: number
  recallChecked: boolean
}

export interface GoldenHotkeyActions {
  close: () => void
  startDrill: () => void
  setView: (view: GoldenView) => void
  setPhase: (phase: GoldenPhase) => void
  beginFill: () => void
  checkFill: () => void
  nextFillRound: () => void
  beginAssemble: () => void
  checkAssemble: () => void
  markSummary: () => void
  nextSentence: () => void
  prevSentence: () => void
  restartSentence: () => void
  revealRecall: () => void
  checkRecall: () => void
  nextRecall: () => void
  restartRecallSentence: () => void
  speakCurrent: () => void
}

/**
 * D老师小课堂快捷键。规则只在“哪种视图/阶段”分派，具体能不能提交、
 * 能不能看小结由上下文事实决定；输入框里只放行 Enter / Ctrl+Enter。
 *
 *   Enter = 主操作（开始 / 检查 / 提交 / 下一句）
 *   Ctrl/⌘ + Enter = 逆向默写提交（保留 textarea 普通 Enter 换行）
 *   H = 看整句 / 看答案   R = 朗读   S = 看本句小结   X = 重来
 *   Q / E = 上一句 / 下一句   Esc = 退出
 */
export function useGoldenHotkeys(ctx: GoldenHotkeyContext, actions: GoldenHotkeyActions): void {
  useHotkeys(
    (e) => {
      if (!ctx.open || isComposing(e) || e.repeat) return
      if (e.key === 'Escape') {
        e.preventDefault()
        actions.close()
        return
      }
      const inField = isEditableTarget(e.target)
      const enter = e.key === 'Enter'
      const space = e.key === ' ' || e.code === 'Space'
      const key = e.key.toLowerCase()
      const main = enter || space
      const ctrlEnter = enter && (e.ctrlKey || e.metaKey)

      if (ctx.view === 'drill') {
        if (ctx.phase === 'preview') {
          if (main && !inField) {
            e.preventDefault()
            actions.beginFill()
          } else if (key === 'r' && !inField) {
            e.preventDefault()
            actions.speakCurrent()
          } else if (key === 'x' && !inField) {
            e.preventDefault()
            actions.restartSentence()
          } else if (key === 'q' && !inField) {
            e.preventDefault()
            actions.prevSentence()
          } else if (key === 'e' && !inField) {
            e.preventDefault()
            actions.nextSentence()
          }
          return
        }
        if (ctx.phase === 'fill') {
          if (enter) {
            e.preventDefault()
            if (ctx.fillRoundPassed) actions.nextFillRound()
            else if (ctx.fillCorrect === true) actions.beginAssemble()
            else actions.checkFill()
            return
          }
          if (inField || hasModifier(e)) return
          if (key === 'h') {
            e.preventDefault()
            actions.setPhase('preview')
          } else if (key === 's') {
            if (ctx.fillCorrect === true || !ctx.hasCloze) {
              e.preventDefault()
              actions.markSummary()
            }
          } else if (key === 'x') {
            e.preventDefault()
            actions.restartSentence()
          } else if (key === 'r') {
            e.preventDefault()
            actions.speakCurrent()
          } else if (key === 'q') {
            e.preventDefault()
            actions.prevSentence()
          } else if (key === 'e') {
            e.preventDefault()
            actions.nextSentence()
          }
          return
        }
        if (ctx.phase === 'assemble') {
          if (enter) {
            e.preventDefault()
            if (ctx.assembleChecked === true) actions.markSummary()
            else if (ctx.assembleOrderLength === ctx.assembleTargetCount) actions.checkAssemble()
            return
          }
          if (inField || hasModifier(e)) return
          if (key === 'x') {
            e.preventDefault()
            actions.beginAssemble()
          } else if (key === 's') {
            if (ctx.assembleChecked === true || !ctx.hasAssembly) {
              e.preventDefault()
              actions.markSummary()
            }
          } else if (key === 'r') {
            e.preventDefault()
            actions.speakCurrent()
          } else if (key === 'q') {
            e.preventDefault()
            actions.prevSentence()
          } else if (key === 'e') {
            e.preventDefault()
            actions.nextSentence()
          }
          return
        }
        if (ctx.phase === 'summary') {
          if (main && !inField) {
            e.preventDefault()
            actions.setPhase('imitation')
          } else if (key === 'r' && !inField) {
            e.preventDefault()
            actions.speakCurrent()
          }
          return
        }
        if (ctx.phase === 'imitation') {
          if (inField || hasModifier(e)) return
          if (key === 'r') {
            e.preventDefault()
            actions.speakCurrent()
          } else if (key === 'q') {
            e.preventDefault()
            actions.prevSentence()
          } else if (key === 'e') {
            e.preventDefault()
            actions.nextSentence()
          }
          return
        }
      }

      if (ctx.view === 'recall') {
        if (ctrlEnter) {
          e.preventDefault()
          if (!ctx.recallChecked) actions.checkRecall()
          return
        }
        if (enter) {
          if (ctx.recallChecked) {
            e.preventDefault()
            actions.nextRecall()
          } else if (inField) {
            // textarea 普通回车留给换行
            return
          }
          e.preventDefault()
          actions.checkRecall()
          return
        }
        if (inField || hasModifier(e)) return
        if (key === 'h') {
          e.preventDefault()
          actions.revealRecall()
        } else if (key === 'x') {
          e.preventDefault()
          actions.restartRecallSentence()
        } else if (key === 'e') {
          e.preventDefault()
          actions.nextRecall()
        } else if (key === 'r') {
          e.preventDefault()
          actions.speakCurrent()
        }
        return
      }

      if (ctx.view === 'home' || ctx.view === 'plan') {
        if (main && !inField) {
          e.preventDefault()
          actions.startDrill()
        } else if (key === 'r' && !inField) {
          e.preventDefault()
          actions.speakCurrent()
        }
        return
      }

      if (ctx.view === 'summary') {
        if (key === 'h' && !inField) {
          e.preventDefault()
          actions.setView('home')
        }
      }
    },
    ctx.open,
    45,
  )
}
