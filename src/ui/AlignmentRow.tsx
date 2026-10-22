/**
 * 对齐校准行：正文起点 + 文字整体偏移。
 *
 * 只在「有原文、且没手动选字锚点」时出现（条件的判断留在调用方，
 * 因为它是页面级的 visible 规则，不是这一行的内部状态）。
 */
export function AlignmentRow({
  textStartChunk,
  offsetWords,
  onSetTextStart,
  onClearTextStart,
  onNudgeWords,
  onResetAll,
}: {
  textStartChunk: number
  offsetWords: number
  onSetTextStart: () => void
  onClearTextStart: () => void
  onNudgeWords: (delta: number) => void
  onResetAll: () => void
}) {
  return (
    <div className="row">
      <span className="lab">对齐校准</span>
      <button
        className={textStartChunk > 0 ? 'chip on' : 'chip'}
        onClick={onSetTextStart}
        title="听到正文第一句时，切到那一块按下这个"
      >
        正文从这块开始（S）
      </button>
      <span className="off">{textStartChunk > 0 ? `第 ${textStartChunk + 1} 块` : '第 1 块'}</span>
      {textStartChunk > 0 && (
        <button className="ghost sm" onClick={onClearTextStart}>
          取消
        </button>
      )}
      <span className="lab">文字偏移</span>
      <button className="chip" onClick={() => onNudgeWords(-15)} title="文字往后挪 15 词">
        −15
      </button>
      <button className="chip" onClick={() => onNudgeWords(-3)} title="文字往后挪 3 词">
        −3
      </button>
      <span className="off">{offsetWords > 0 ? `+${offsetWords}` : offsetWords} 词</span>
      <button className="chip" onClick={() => onNudgeWords(3)} title="文字往前赶 3 词">
        +3
      </button>
      <button className="chip" onClick={() => onNudgeWords(15)} title="文字往前赶 15 词">
        +15
      </button>
      {(offsetWords !== 0 || textStartChunk > 0) && (
        <button className="ghost sm" onClick={onResetAll}>
          全部归零
        </button>
      )}
    </div>
  )
}
