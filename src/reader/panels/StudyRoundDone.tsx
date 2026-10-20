import type { StudyMode } from '../../core/vocab'
import { fmtDur } from '../format'

export interface StudyRoundDoneProps {
  counts: { know: number; fuzzy: number; forgot: number }
  liveSeconds: number
  forgotCount: number
  mode: StudyMode
  onRetryForgot: () => void
  onRestart: () => void
  onExam: () => void
  onClose: () => void
}

/** 本轮小结：认识/模糊/忘记 + 用时，重练忘记或再来一轮。 */
export default function StudyRoundDone({
  counts,
  liveSeconds,
  forgotCount,
  mode,
  onRetryForgot,
  onRestart,
  onExam,
  onClose,
}: StudyRoundDoneProps) {
  return (
    <div className="study-done">
      <p>
        本轮完成：认识 <b>{counts.know}</b> · 模糊 <b>{counts.fuzzy}</b> · 忘记了 <b>{counts.forgot}</b>，用时{' '}
        {fmtDur(liveSeconds)}。
      </p>
      <div className="bar">
        {forgotCount > 0 && (
          <button className="primary" onClick={onRetryForgot}>
            重练忘记的 {forgotCount} 个
          </button>
        )}
        <button className={forgotCount ? '' : 'primary'} onClick={onRestart}>
          再来一轮（{mode === 'review' ? '复习' : '新学习'}）
        </button>
        <button onClick={onExam}>考试</button>
        <button onClick={onClose}>回到阅读</button>
      </div>
    </div>
  )
}
