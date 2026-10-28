import type { StudySpellMissView } from './studyPanelModel'

export interface StudySpellMissProps {
  miss: StudySpellMissView
  onAck: () => void
}

/**
 * 拼写判错页：这个词已经判「不认识」并重排，必须先确认再继续。
 * 从 `StudyPanel` 拆出来，避免面板文件里混入一条独立的确认流程。
 */
export default function StudySpellMiss({ miss, onAck }: StudySpellMissProps) {
  return (
    <div className="study-card spell-miss">
      <div className="study-word">{miss.word}</div>
      <div className="study-result bad">✘ 拼写错误：你写的是「{miss.input || '（空）'}」</div>
      {miss.meaning && <div className="study-meaning">{miss.meaning}</div>}
      <div className="muted spell-miss-note">
        已判为「不认识」：这个词的复习进度已归零。
        {miss.requeued
          ? '本轮稍后会从「看词 → 释义 → 拼写」重新学。'
          : '本轮已经练满 3 次，明天从「看词」开始重学。'}
        不能靠再输入一次蒙对，也不能直接跳过。
      </div>
      <button className="primary" autoFocus onClick={onAck}>
        确认，从头重学（稍后再出场）
      </button>
      <div className="muted spell-miss-hint">
        确认继续（<kbd>空格</kbd>）
      </div>
    </div>
  )
}
