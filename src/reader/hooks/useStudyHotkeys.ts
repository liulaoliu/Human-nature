import type { ReviewFuzzyChoice, ReviewGrade, StudyMode } from '../../core/vocab'
import { useHotkeys } from '../useHotkeys'

/**
 * 背单词的键盘映射（从 `useStudySession` 拆出来，**面板上每个按钮都标了对应键**）。
 *
 *   空格 / 回车 = 主操作：看答案 → 继续（看卡）→ 下一词；复习模式 = 看一眼释义
 *   H = 看答案       1 / 2 / 3 = 认识 / 模糊 / 忘记了      U = 不认识      M = 记错了
 *   R = 朗读         Q / E = 上一个 / 下一个                Esc = 结束
 *
 * 「看答案」用 H 而不是 A：释义题的 A / D 是左右切换选项（那边先占的键）。
 *
 * 这里只做「哪个键对应哪个动作」，不做任何判定：能不能评分、模糊要不要先摊卡，
 * 都由会话（`reviewStep` / `learn`）算好，这里按 `ctx` 里的事实分派。
 * 分派顺序就是屏幕上的层次：拼写测试 → 门禁 → 学习四选项 → 复习三键 → 普通卡。
 */

export interface StudyKeyContext {
  mode: StudyMode
  index: number
  queueLength: number
  spelling: boolean
  revealed: boolean
  checked: boolean
  editOpen: boolean
  drillOn: boolean
  spellMiss: boolean
  pendingForgot: boolean
  meaningGate: boolean
  /** 组末拼写测试进行中：键盘归输入框（回车检查）。 */
  roundTest: boolean
  learnPhase: boolean
  learnReveal: boolean
  learnGraded: boolean
  reviewFuzzy: boolean
  reviewGraded: boolean
  reviewKeys: boolean
  /** 当前卡的单词（R 朗读用）；组末拼写测试时给 null。 */
  word: string | null
}

export interface StudyKeyActions {
  /** 学习模式「看答案」（判不认识 + 高亮正确项）。 */
  revealAnswer: () => void
  /** 打断「看答案」的停留，进单词卡。 */
  continueLearn: () => void
  next: () => void
  back: () => void
  close: () => void
  /** 标为「不认识」（复习模式没有这个键，用「记错了」）。 */
  markUnknown: () => void
  speak: (word: string) => void
  /** 翻面 / 收起释义（复习模式空格是「看一眼」）。 */
  setRevealed: (updater: (revealed: boolean) => boolean) => void
  setChecked: (checked: boolean) => void
  /** 认识 / 模糊 / 忘记了（复习模式走三键状态机）。 */
  grade: (grade: ReviewGrade) => void
  /** 复习模式模糊后的出口。 */
  chooseReview: (choice: ReviewFuzzyChoice) => void
}

export function useStudyHotkeys(ctx: StudyKeyContext, actions: StudyKeyActions): void {
  const enabled =
    !!ctx.queueLength && !ctx.editOpen && !ctx.drillOn && !ctx.meaningGate && !ctx.spellMiss && !ctx.pendingForgot

  useHotkeys(
    (e) => {
      // 组末拼写测试：键盘交给输入框（回车检查），不给全局快捷键抢
      if (ctx.roundTest) return
      if (ctx.editOpen || ctx.drillOn || ctx.spellMiss || ctx.pendingForgot) return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      const key = e.key.toLowerCase()
      const main = e.key === ' ' || e.key === 'Enter'

      if (ctx.learnPhase) {
        if (main || key === 'h') {
          e.preventDefault()
          actions.revealAnswer()
        }
        return
      }
      if (ctx.learnReveal) {
        if (main || key === 'h') {
          e.preventDefault()
          actions.continueLearn()
        }
        return
      }
      // 学习模式判完只等「下一词」：1/2/3 不再二次评分
      if (ctx.mode === 'learn' && ctx.learnGraded) {
        if (main || e.key === 'Escape') {
          e.preventDefault()
          actions.next()
        }
        return
      }
      // 复习模式「模糊」待定：空格认下模糊；M = 记错了
      if (ctx.reviewFuzzy) {
        if (main || key === 'e') {
          e.preventDefault()
          actions.chooseReview('next')
        } else if (key === 'm') {
          e.preventDefault()
          actions.chooseReview('missed')
        }
        return
      }
      // 复习模式已判（忘记 / 记错了）停卡上：只等「下一词」
      if (ctx.reviewGraded) {
        if (main || key === 'e') {
          e.preventDefault()
          actions.next()
        }
        return
      }

      const t = e.target as HTMLElement | null
      const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      // 复习模式看见单词就能判（不用先翻面）；其它模式要「翻面」或「判完拼写」才给分
      const canGrade = ctx.mode === 'review' ? ctx.reviewKeys : ctx.spelling ? ctx.checked : ctx.revealed
      const gradeKeys: Record<string, ReviewGrade> = { '1': 'good', '2': 'hard', '3': 'again' }

      // 拼写模式下输入框还 focus 着；判卷后仍要能用 1/2/3 评分
      if (inField) {
        if (canGrade && gradeKeys[e.key]) {
          e.preventDefault()
          actions.grade(gradeKeys[e.key])
        }
        return
      }

      if (main || key === 'h') {
        e.preventDefault()
        if (ctx.index >= ctx.queueLength) return
        // 复习模式：空格 / H = 看一眼释义（再按一次收起）。判「认识」必须按 1，防手滑。
        if (ctx.mode === 'review') {
          actions.setRevealed((r) => !r)
          return
        }
        if (!canGrade) {
          if (ctx.spelling) actions.setChecked(true)
          else actions.setRevealed(() => true)
          return
        }
        actions.grade('good')
      } else if (gradeKeys[e.key]) {
        if (canGrade) actions.grade(gradeKeys[e.key])
      } else if (key === 'u' && ctx.mode !== 'review') {
        // 「不认识」只在卡片摊开时才有（复习模式用「记错了」，见 M）
        if (!ctx.revealed || (ctx.mode === 'learn' && ctx.learnGraded)) return
        e.preventDefault()
        actions.markUnknown()
      } else if (key === 'r') {
        // 拼写模式判卷前读出来就剧透了（自动朗读也为此关掉）
        if (!ctx.word || (ctx.spelling && !ctx.checked)) return
        e.preventDefault()
        if (!e.repeat) actions.speak(ctx.word)
      } else if (key === 'q') {
        e.preventDefault()
        actions.back()
      } else if (key === 'e') {
        e.preventDefault()
        actions.next()
      } else if (e.key === 'Escape') {
        actions.close()
      }
    },
    enabled,
    40,
  )
}
