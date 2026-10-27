import { GOLDEN_TARGET_KIND_LABEL, type GoldenCloze } from '../../../core/golden'
import type { GoldenDrillApi, GoldenSentenceLineApi } from './types'

function SentenceLine({ cloze, mode, api }: {
  cloze: GoldenCloze
  mode: 'fill' | 'assemble'
  api: GoldenSentenceLineApi
}) {
  return (
    <div className="golden-sentence">
      {cloze.parts.map((p, i) => {
        if (!p.blank) return <span key={i}>{p.text}</span>
        const blank = cloze.blanks.find((b) => b.targetIndex === p.targetIndex)
        return (
          <span className="golden-blank" key={i} title={blank?.hint}>
            [{p.blankIndex}]
          </span>
        )
      })}
      {mode === 'assemble' && (
        <div className="golden-bank">
          {api.assembly?.bank.map((w) => {
            const used = api.assembleOrder.includes(w)
            return (
              <button key={w} disabled={used} onClick={() => api.setAssembleOrder([...api.assembleOrder, w])}>
                {w}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function GoldenDrillView({ api, onSpeak }: { api: GoldenDrillApi; onSpeak: (s: string) => void }) {
  const cur = api.current
  const sentence = api.currentSentence
  if (!cur || !sentence) return <div className="golden-body muted">没有可练的句子。</div>
  const phase = api.phase
  return (
    <div className="golden-body">
      <div className="bar golden-drill-bar">
        <button onClick={() => api.setView('home')}>← 课程页</button>
        <span className="muted">第 {api.index + 1} / {api.ordered.length} 句</span>
        <span className={'golden-chip' + (phase === 'preview' ? ' on' : '')}>预览</span>
        <span className={'golden-chip' + (phase === 'fill' ? ' on' : '')}>句子填空</span>
        <span className={'golden-chip' + (phase === 'assemble' ? ' on' : '')}>拼接整句</span>
        <span className={'golden-chip' + (phase === 'summary' ? ' on' : '')}>本句小结</span>
        <button onClick={api.speakCurrent} title="播放整句">🔊</button>
        <button onClick={api.restartSentence} title="重开本轮首次记录；已掌握不会降级">再练一次</button>
      </div>
      {phase === 'preview' && (
        <>
          <div className="golden-preview">
            <div className="golden-en">{sentence.text}</div>
            {cur.zh || sentence.translation ? <div className="muted">{cur.zh ?? sentence.translation}</div> : null}
            {cur.pattern && <div className="golden-note">句型：{cur.pattern}</div>}
            {cur.tense && <div className="golden-note">时态：{cur.tense}</div>}
          </div>
          <div className="bar">
            <button className="primary" onClick={api.beginFill}>开始练习</button>
            <button onClick={() => onSpeak(sentence.text)}>🔊 听整句</button>
            <button onClick={api.nextSentence}>跳过本句</button>
          </div>
        </>
      )}
      {phase === 'fill' && !api.cloze && (
        <div className="golden-preview">
          <div className="muted">本句没有要填的学习点（可能已被「本课去重」跳过）。</div>
          <div className="bar">
            <button className="primary" onClick={api.markSummary}>直接看本句小结</button>
            <button onClick={api.nextSentence}>下一句</button>
          </div>
        </div>
      )}
      {phase === 'fill' && api.cloze && (
        <>
          <SentenceLine cloze={api.cloze} mode="fill" api={api} />
          <div className="golden-inputs">
            {api.cloze.blanks.map((b) => (
              <label key={b.targetIndex}>
                <span>[{b.index}] {b.hint ?? GOLDEN_TARGET_KIND_LABEL[b.kind]}</span>
                <input
                  value={api.fillInputs[b.targetIndex] ?? ''}
                  onChange={(e) => {
                    const next = [...api.fillInputs]
                    next[b.targetIndex] = e.target.value
                    api.setFillInputs(next)
                  }}
                  placeholder={b.hint ?? '填英文'}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </label>
            ))}
          </div>
          <div className="bar">
            <button className="primary" onClick={api.checkFill}>检查</button>
            <button onClick={() => api.setPhase('preview')}>看整句</button>
            {api.fillCorrect === false && <span className="golden-bad">还有空不对，改一下再检查</span>}
            {api.fillCorrect === true && <button className="primary" onClick={api.beginAssemble}>下一步：拼接整句</button>}
          </div>
          {api.fillChecked && (
            <div className="golden-feedback">
              {api.cloze.blanks.map((b, i) => (
                <span key={b.targetIndex} className={api.fillChecked?.[i] ? 'good' : 'bad'}>
                  [{b.index}] {b.answer} {api.fillChecked?.[i] ? '✓' : '✗'}
                </span>
              ))}
            </div>
          )}
        </>
      )}
      {phase === 'assemble' && !api.assembly && (
        <div className="golden-preview">
          <div className="muted">本句没有可拼的学习点。</div>
          <button className="primary" onClick={api.markSummary}>看本句小结</button>
        </div>
      )}
      {phase === 'assemble' && api.assembly && (
        <>
          <SentenceLine cloze={api.assembly.cloze} mode="assemble" api={api} />
          <div className="golden-order">
            {api.assembleOrder.map((w, i) => (
              <button key={`${w}-${i}`} onClick={() => api.setAssembleOrder(api.assembleOrder.filter((_, j) => j !== i))}>
                {w} ×
              </button>
            ))}
            {!api.assembleOrder.length && <span className="muted">按句子顺序点下面的词块</span>}
          </div>
          <div className="bar">
            <button className="primary" onClick={api.checkAssemble} disabled={api.assembleOrder.length !== api.assembly.cloze.targets.length}>提交答案</button>
            <button onClick={api.beginAssemble}>重来</button>
            {api.assembleChecked === false && <span className="golden-bad">顺序不对，再试一次</span>}
            {api.assembleChecked === true && <button className="primary" onClick={api.markSummary}>看本句小结</button>}
          </div>
        </>
      )}
      {phase === 'summary' && (
        <>
          <div className="golden-preview">
            <div className="golden-en">{sentence.text}</div>
            {cur.zh || sentence.translation ? <div className="muted">{cur.zh ?? sentence.translation}</div> : null}
            {cur.pattern && <div className="golden-note">句型：{cur.pattern}</div>}
            {cur.tense && <div className="golden-note">时态：{cur.tense}</div>}
            {cur.note && <div className="golden-note">用法：{cur.note}</div>}
          </div>
          <div className="golden-targets">
            {cur.targets.map((t, i) => (
              <span key={i} className="golden-target">
                <b>{GOLDEN_TARGET_KIND_LABEL[t.kind]}</b> {t.en}{t.zh ? ` — ${t.zh}` : ''}
              </span>
            ))}
          </div>
          <div className="bar">
            <button className="primary" onClick={api.nextSentence}>
              {api.index + 1 >= api.ordered.length ? '进入逆向回顾' : '下一句'}
            </button>
            <button onClick={api.speakCurrent}>🔊 听整句</button>
          </div>
        </>
      )}
    </div>
  )
}
