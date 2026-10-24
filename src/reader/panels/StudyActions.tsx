import type { VocabItem } from '../../types/document'
import { fmtInterval } from '../format'
import { review, type ReviewGrade, type StudyMode } from '../../core/vocab'
import DrillBoard, { type MeaningReveal } from './StudyDrill'

/**
 * 单词卡下方的「动作区」：按当前状态决定显示哪一组按钮。
 *
 * 从 StudyPanel 里拆出来的原因：这一块是**纯状态机**——锤炼 / 学习释义页 / 判完等下一词 /
 * 复习模糊待定 / 复习已判 / 忘了但刚选对释义 / 可评分 / 拼写待检查 / 等翻面，
 * 九种状态的优先级不能乱，跟卡片渲染是两件事。放在一个组件里，优先级一眼能读，
 * 也能单独为它写「哪个状态下该出现哪个按钮」的测试。
 *
 * 注意：这里只决定**显示什么**，所有写库动作都由上层（useStudySession）注入。
 */
export interface StudyActionsProps {
  card: VocabItem
  items: VocabItem[]
  mode: StudyMode
  /** 超时未评分 → 强制锤炼，锤炼完才回到评分。 */
  drillOn: boolean
  /** 学习模式的「4 条释义」页（做题中 + 揭示后停留）。 */
  learnQuizOn: boolean
  learnReveal: MeaningReveal | null
  learnGraded: boolean
  reviewMode: boolean
  reviewFuzzy: boolean
  reviewGraded: boolean
  showMeaningGate: boolean
  canGrade: boolean
  spellingFront: boolean
  gradeInfo: string

  onSpeak: (word: string) => void
  onDrillCleared: () => void
  onSpellMiss: (typed: string) => void
  onLearnContinue: () => void
  onNext: () => void
  onReviewChoice: (choice: 'next' | 'missed') => void
  onGrade: (grade: ReviewGrade) => void
  onReviewAnswer: (grade: ReviewGrade) => void
  onCheckSpelling: () => void
  onReveal: () => void
}

export default function StudyActions(props: StudyActionsProps) {
  const {
    card,
    items,
    mode,
    drillOn,
    learnQuizOn,
    learnReveal,
    learnGraded,
    reviewMode,
    reviewFuzzy,
    reviewGraded,
    showMeaningGate,
    canGrade,
    spellingFront,
    gradeInfo,
    onSpeak,
    onDrillCleared,
    onSpellMiss,
    onLearnContinue,
    onNext,
    onReviewChoice,
    onGrade,
    onReviewAnswer,
    onCheckSpelling,
    onReveal,
  } = props

  // 超时未评分 → 强制锤炼
  if (drillOn) {
    return <DrillBoard card={card} items={items} onSpeak={onSpeak} onDone={onDrillCleared} onSpellMiss={onSpellMiss} />
  }

  if (learnQuizOn) {
    // 选错后停在释义页：正确项浅绿、你选的那项浅红，点「继续」才进单词卡
    if (!learnReveal || learnReveal.auto) return null
    return (
      <div className="bar study-actions">
        <button className="primary" onClick={onLearnContinue}>
          继续（看单词卡） <kbd>空格</kbd>
        </button>
      </div>
    )
  }

  // 学习模式判完了：只等「下一词」，不再显示三档评分（避免二次评分）
  if (learnGraded && mode === 'learn') {
    return (
      <div className="bar study-actions">
        <button className="primary" onClick={onNext}>
          下一词 <kbd>空格</kbd>
        </button>
        {gradeInfo && <span className="grade-info">{gradeInfo}</span>}
      </div>
    )
  }

  // 复习模式判了「模糊」：先摊开卡看释义，再决定是认下模糊还是其实不认识
  if (reviewFuzzy) {
    return (
      <div className="bar study-actions">
        <button className="primary" onClick={() => onReviewChoice('next')}>
          下一词 <kbd>空格</kbd>
        </button>
        <button className="danger" onClick={() => onReviewChoice('missed')}>
          记错了 · 其实不认识 <kbd>M</kbd>
        </button>
        <span className="muted">看过释义才想起来不认识？点「记错了」，按忘记重排</span>
      </div>
    )
  }

  // 复习模式已判「忘记了 / 记错了」：停在卡上看一眼答案，点「下一词」继续
  if (reviewGraded) {
    return (
      <div className="bar study-actions">
        <button className="primary" onClick={onNext}>
          下一词 <kbd>空格</kbd>
        </button>
        {gradeInfo && <span className="grade-info">{gradeInfo}</span>}
      </div>
    )
  }

  if (showMeaningGate) return null

  if (canGrade) {
    return (
      <>
        {!reviewMode && (
          <div className="muted grade-preview">
            预计下次：认识 {fmtInterval(review(card.reviewState, 'good').interval)} · 模糊{' '}
            {fmtInterval(review(card.reviewState, 'hard').interval)} · 忘记了{' '}
            {fmtInterval(review(card.reviewState, 'again').interval)}
          </div>
        )}
        <div className="bar study-actions">
          <button className="primary" onClick={() => (reviewMode ? onReviewAnswer('good') : onGrade('good'))}>
            认识 <kbd>1</kbd>
          </button>
          <button onClick={() => (reviewMode ? onReviewAnswer('hard') : onGrade('hard'))}>
            模糊 <kbd>2</kbd>
          </button>
          <button onClick={() => (reviewMode ? onReviewAnswer('again') : onGrade('again'))}>
            忘记了 <kbd>3</kbd>
          </button>
        </div>
      </>
    )
  }

  if (spellingFront) {
    return (
      <button className="primary" onClick={onCheckSpelling}>
        检查（回车）
      </button>
    )
  }

  return (
    <button className="primary" onClick={onReveal}>
      显示释义（空格）
    </button>
  )
}
