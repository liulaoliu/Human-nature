import { isMastered } from './shared'
import type { GoldenRecallApi } from './types'

export default function GoldenRecallView({ api, onSpeak }: { api: GoldenRecallApi; onSpeak: (s: string) => void }) {
  const cur = api.currentRecallSentence
  const sentence = api.currentRecallText
  if (!cur || !sentence) return <div className="golden-body muted">没选金句。</div>
  const rec = api.currentRecallProgress
  return (
    <div className="golden-body">
      <div className="bar golden-drill-bar">
        <button onClick={() => api.setView('home')}>← 课程页</button>
        <b>{api.reviewMode ? '待回顾' : '逆向回顾'}</b>
        <span className="muted">第 {api.recallIndex + 1} / {api.recallList.length} 句</span>
        {isMastered(rec) && <span className="golden-good">已掌握</span>}
        <button onClick={() => onSpeak(sentence.text)}>🔊</button>
        <button onClick={api.restartRecallSentence} title="重开这一句的首次记录，回到填空/拼句/小结">再练一次本句</button>
      </div>
      <div className="golden-recall-zh">{cur.zh || sentence.translation || '（这句没有中文提示，直接回忆原句）'}</div>
      <div className="muted golden-hint">先想一下本句用到了哪些句型、词组和单词，再把整句写出来。</div>
      <textarea
        className="golden-recall-input"
        rows={4}
        value={api.recallInput}
        onChange={(e) => api.setRecallInput(e.target.value)}
        placeholder="默写整句（首答 exact / 接近才算掌握；点“看答案”算未掌握）"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      <div className="bar">
        <button className="primary" onClick={api.checkRecall} disabled={!api.recallInput.trim()}>检查</button>
        <button onClick={api.revealRecall}>看答案</button>
        <button className="primary" onClick={api.nextRecall}>下一句</button>
      </div>
      {api.recallChecked && (
        <div className={'golden-recall-result ' + (api.recallChecked.firstOk ? 'good' : 'bad')}>
          {api.recallChecked.firstOk ? '首次正确 ✓' : `接近度 ${Math.round(api.recallChecked.closeness.ratio * 100)}% —— 这次不算掌握`}
          <div className="golden-diff">
            {api.recallChecked.diff.map((d, i) => (
              <span key={i} className={d.kind}>
                {d.kind === 'same' ? d.text : d.kind === 'add' ? ` [漏:${d.text}]` : ` [多:${d.text}]`}
              </span>
            ))}
          </div>
        </div>
      )}
      {api.recallRevealed && (
        <div className="golden-preview">
          <div className="golden-en">{sentence.text}</div>
          {cur.zh && <div className="muted">{cur.zh}</div>}
        </div>
      )}
    </div>
  )
}
