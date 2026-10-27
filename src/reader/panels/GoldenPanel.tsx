import { useMemo, useState } from 'react'
import type { useGoldenDrill } from '../hooks/useGoldenDrill'
import type { GoldenDrillRecord } from '../../core/goldenProgress'
import { GOLDEN_TARGET_KIND_LABEL, type GoldenCloze } from '../../core/golden'
import { filterGoldenBank, type GoldenBankRow, type GoldenBankStatus } from '../../core/goldenBank'
import type { GoldenPickMode, GoldenSentence } from '../../types/document'

export interface GoldenPanelProps {
  api: ReturnType<typeof useGoldenDrill>
  articleTitle: string
  onSpeak: (text: string) => void
  onExportMarkdown: () => void
  /** 复制 AI 金句课提示词（模块内入口；跑批也会自动排这一项）。 */
  onGenerate?: () => void
  /** 把本课词块带进仿写；没有就不显示按钮。 */
  onOpenWriting?: (mustUse: string[]) => void
  /** 全库金句本。 */
  bankRows?: GoldenBankRow[]
  onExportBankMarkdown?: () => void
  onExportBankAnki?: () => void
}

const ROLE_LABEL: Record<'intro' | 'body' | 'conclusion', string> = {
  intro: '开头段',
  body: '主体段',
  conclusion: '结尾段',
}

function isMastered(rec: GoldenDrillRecord | null): boolean {
  return !!rec?.mastered
}

/** D老师小课堂：课程页 / 选金句 / 逐句锤炼 / 逆向回顾 / 素材总结。 */
export default function GoldenPanel({
  api,
  articleTitle,
  onSpeak,
  onExportMarkdown,
  onGenerate,
  onOpenWriting,
  bankRows = [],
  onExportBankMarkdown,
  onExportBankAnki,
}: GoldenPanelProps) {
  if (!api.open) return null
  return (
    <div className="study golden">
      <div className="bar study-bar">
        <button onClick={api.close} title="退出 D老师小课堂（Esc）">
          退出
        </button>
        <b>D老师小课堂</b>
        <span className="muted">金句锤炼 · 快速掌握句型</span>
        {articleTitle && <span className="muted golden-art">{articleTitle}</span>}
        <span className="muted golden-count">
          {api.summary ? `掌握 ${api.summary.masteredTargets}/${api.summary.totalTargets} 个学习点` : ''}
        </span>
      </div>
      {api.view === 'home' && (
        <GoldenHome api={api} onGenerate={onGenerate} bankCount={bankRows.length} onOpenBank={() => api.setView('bank')} />
      )}
      {api.view === 'bank' && (
        <GoldenBankView
          rows={bankRows}
          onBack={() => api.setView('home')}
          onExportMarkdown={onExportBankMarkdown}
          onExportAnki={onExportBankAnki}
        />
      )}
      {api.view === 'plan' && <GoldenPlan api={api} />}
      {api.view === 'drill' && <GoldenDrillView api={api} onSpeak={onSpeak} />}
      {api.view === 'recall' && <GoldenRecallView api={api} onSpeak={onSpeak} />}
      {api.view === 'summary' && (
        <GoldenSummary api={api} onExportMarkdown={onExportMarkdown} onOpenWriting={onOpenWriting} onSpeak={onSpeak} />
      )}
    </div>
  )
}

function GoldenHome({
  api,
  onGenerate,
  bankCount,
  onOpenBank,
}: {
  api: ReturnType<typeof useGoldenDrill>
  onGenerate?: () => void
  bankCount: number
  onOpenBank: () => void
}) {
  const selected = api.lesson?.selected.length ?? 0
  const summary = api.summary
  const step2Done = selected > 0 && api.ordered.every((s) => api.progressFor(s.id)?.summarySeen === true)
  const nextDrill = api.ordered.findIndex((s) => api.progressFor(s.id)?.summarySeen !== true)
  return (
    <div className="golden-body">
      {api.lesson?.summary && <div className="golden-summary">{api.lesson.summary}</div>}
      <div className="golden-steps">
        <button className="golden-step" onClick={() => api.setView('plan')}>
          <span className="golden-step-no">1</span>
          <span>
            <b>梳理思路</b>
            <small>看本篇段落脉络，挑出要练的金句（已选 {selected} 句）</small>
          </span>
          <span className="golden-step-go">→</span>
        </button>
        <button className="golden-step" onClick={() => api.startDrill(nextDrill >= 0 ? nextDrill : 0)} disabled={!selected}>
          <span className="golden-step-no">2</span>
          <span>
            <b>遣词造句</b>
            <small>预览整句 → 填空 → 拼句 → 本句小结</small>
          </span>
          <span className="golden-step-go">→</span>
        </button>
        <button
          className="golden-step"
          onClick={() => api.startRecall()}
          disabled={!selected || !step2Done}
          title={step2Done ? undefined : '先完成全部句子的遣词造句（预览 → 填空 → 拼句 → 小结）'}
        >
          <span className="golden-step-no">3</span>
          <span>
            <b>逆向回顾</b>
            <small>{step2Done ? '看中文提示，默写整句；首答全对才算掌握' : '完成遣词造句后解锁'}</small>
          </span>
          <span className="golden-step-go">→</span>
        </button>
        <button className="golden-step" onClick={() => api.setView('summary')}>
          <span className="golden-step-no">📄</span>
          <span>
            <b>本课素材总结</b>
            <small>句子 / 句型 / 词组 / 单词，可导出 Markdown</small>
          </span>
          <span className="golden-step-go">→</span>
        </button>
      </div>
      {bankCount > 0 && (
        <div className="bar golden-plan-bar">
          <button onClick={onOpenBank}>📚 全库金句本（{bankCount} 句）</button>
          <span className="muted">跨文章搜索、筛选、导出 Markdown / Anki</span>
        </div>
      )}
      <div className="golden-kpis">
        <span>学习句子 <b>{summary?.selectedSentences ?? 0}</b></span>
        <span>掌握句子 <b>{summary?.masteredSentences ?? 0}</b></span>
        <span>学习点 <b>{summary?.masteredTargets ?? 0}/{summary?.totalTargets ?? 0}</b></span>
      </div>
      {api.reviewCount > 0 && (
        <div className="bar golden-plan-bar">
          <button className="primary" onClick={api.startReview}>
            🔁 待回顾（{api.reviewCount} 句）
          </button>
          <span className="muted">已掌握、今天还没回顾的金句</span>
        </div>
      )}
      <div className="bar golden-plan-bar">
        {onGenerate && (
          <button onClick={onGenerate} title="复制 AI 金句课提示词；把 JSON 粘回「应用结果」后写回文章">
            {api.doc?.golden && api.doc.golden.source !== 'local' ? '重新生成 AI 金句课' : 'AI 生成本课'}
          </button>
        )}
        <button onClick={() => api.setView('plan')}>选金句 / 本课设置</button>
      </div>
      {(!api.doc?.golden || api.doc.golden.source === 'local') && (
        <div className="muted golden-hint">
          还没有 AI 金句课：现在用的是本地版（译文 + 语言点推导）。点「AI 生成本课」或跑一次 D指导指导指导 可让 AI 补句型/时态/更准的词块。
        </div>
      )}
    </div>
  )
}

function GoldenPlan({ api }: { api: ReturnType<typeof useGoldenDrill> }) {
  const lesson = api.lesson
  const selected = new Set(lesson?.selected ?? [])
  const pick = lesson?.options?.pick ?? 'recommended'
  const modes: { key: GoldenPickMode; label: string; hint: string }[] = [
    { key: 'recommended', label: '推荐', hint: '按语言点/搭配/生词打分，默认 10 句' },
    { key: 'all', label: '全篇', hint: '按原文顺序全部练（长文慎用）' },
    { key: 'manual', label: '手动', hint: '自己勾句子' },
    { key: 'ai', label: 'AI 推荐', hint: '用 AI 挑的金句' },
  ]
  return (
    <div className="golden-body">
      <div className="bar golden-plan-bar">
        <button onClick={() => api.setView('home')}>← 课程页</button>
        <b>梳理思路 · 选金句</b>
        <button className="primary" onClick={() => api.startDrill()} disabled={!selected.size}>
          开始练（{selected.size} 句）
        </button>
      </div>
      <div className="golden-outline">
        {lesson?.outline.map((sec) => (
          <div className="golden-sec" key={sec.paraId}>
            <b>{ROLE_LABEL[sec.role]}</b>
            {sec.points.map((p, i) => <span className="muted" key={i}>{p}</span>)}
          </div>
        ))}
      </div>
      <div className="bar golden-modes">
        <span className="muted">金句来源</span>
        {modes.map((m) => (
          <button
            key={m.key}
            className={pick === m.key ? 'primary' : ''}
            onClick={() => api.setPick(m.key)}
            disabled={m.key === 'ai' && !lesson?.aiSelected?.length}
            title={m.hint}
          >
            {m.label}
          </button>
        ))}
        <label className="check-inline" title="同一词块只在本课第一次出现的地方练；默认关（按句独立）">
          <input type="checkbox" checked={lesson?.options?.dedupe === true} onChange={(e) => api.setDedupe(e.target.checked)} />
          本课去重
        </label>
      </div>
      <div className="golden-cand-list">
        {api.candidates.map((c) => {
          const s = api.doc?.sentences.find((x) => x.id === c.id)
          if (!s) return null
          const on = selected.has(c.id)
          return (
            <label className={'golden-cand' + (on ? ' on' : '')} key={c.id}>
              <input type="checkbox" checked={on} onChange={() => api.toggleSentence(c.id)} />
              <span className="golden-cand-text">
                <b>{s.text}</b>
                {s.translation && <small>{s.translation}</small>}
                <small className="golden-reason">{c.reasons.join(' · ') || '可练'}</small>
              </span>
              <span className="golden-score">{c.score}</span>
            </label>
          )
        })}
        {!api.candidates.length && <div className="muted">这篇还没有可用的句子。</div>}
      </div>
    </div>
  )
}

function SentenceLine({ cloze, mode, api }: {
  cloze: GoldenCloze
  mode: 'fill' | 'assemble'
  api: ReturnType<typeof useGoldenDrill>
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

function GoldenDrillView({ api, onSpeak }: { api: ReturnType<typeof useGoldenDrill>; onSpeak: (s: string) => void }) {
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

function GoldenRecallView({ api, onSpeak }: { api: ReturnType<typeof useGoldenDrill>; onSpeak: (s: string) => void }) {
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

function GoldenBankView({
  rows,
  onBack,
  onExportMarkdown,
  onExportAnki,
}: {
  rows: GoldenBankRow[]
  onBack: () => void
  onExportMarkdown?: () => void
  onExportAnki?: () => void
}) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<GoldenBankStatus>('all')
  const filtered = useMemo(() => filterGoldenBank(rows, { query, status }), [rows, query, status])
  return (
    <div className="golden-body">
      <div className="bar golden-plan-bar">
        <button onClick={onBack}>← 课程页</button>
        <b>全库金句本</b>
        <span className="muted">{filtered.length}/{rows.length} 句</span>
        {onExportMarkdown && <button onClick={onExportMarkdown}>导出 Markdown</button>}
        {onExportAnki && <button onClick={onExportAnki}>导出 Anki</button>}
      </div>
      <div className="bar golden-modes">
        <input
          className="golden-bank-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索英文 / 中文 / 句型 / 词块"
        />
        {(['all', 'todo', 'mastered', 'due'] as const).map((k) => (
          <button key={k} className={status === k ? 'primary' : ''} onClick={() => setStatus(k)}>
            {k === 'all' ? '全部' : k === 'todo' ? '待掌握' : k === 'mastered' ? '已掌握' : '待回顾'}
          </button>
        ))}
      </div>
      <div className="golden-bank-list">
        {filtered.map((r) => (
          <div className="golden-bank-row" key={`${r.articleId}|${r.sentenceId}`}>
            <div className="golden-bank-head">
              <b>{r.articleTitle}</b>
              <span className="muted">{r.sentenceId}</span>
              {r.due && <span className="golden-bank-due">待回顾</span>}
              {r.mastered && <span className="golden-good">已掌握</span>}
            </div>
            <div className="golden-en">{r.text}</div>
            {r.zh && <div className="muted">{r.zh}</div>}
            {r.pattern && <div className="golden-note">句型：{r.pattern}</div>}
            {r.tense && <div className="golden-note">时态：{r.tense}</div>}
            <div className="golden-targets">
              {r.targets.map((t, i) => (
                <span className="golden-target" key={i}>
                  <b>{GOLDEN_TARGET_KIND_LABEL[t.kind]}</b> {t.en}{t.zh ? ` — ${t.zh}` : ''}
                </span>
              ))}
            </div>
          </div>
        ))}
        {!filtered.length && <div className="muted">没有匹配的金句。</div>}
      </div>
    </div>
  )
}

function GoldenSummary({ api, onExportMarkdown, onOpenWriting, onSpeak }: {
  api: ReturnType<typeof useGoldenDrill>
  onExportMarkdown: () => void
  onOpenWriting?: (mustUse: string[]) => void
  onSpeak: (s: string) => void
}) {
  const lesson = api.lesson
  const summary = api.summary
  const targets = useMemo(() => {
    if (!lesson) return []
    const seen = new Set<string>()
    return lesson.sentences.flatMap((s) => s.targets.filter((t) => {
      const key = `${t.kind}|${t.en.toLowerCase()}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }))
  }, [lesson])
  if (!lesson) return <div className="golden-body muted">还没有金句课。</div>
  return (
    <div className="golden-body">
      <div className="bar golden-drill-bar">
        <button onClick={() => api.setView('home')}>← 课程页</button>
        <b>本课素材总结</b>
        <span className="muted">{summary?.masteredSentences ?? 0}/{summary?.selectedSentences ?? 0} 句掌握</span>
        <button onClick={onExportMarkdown}>导出 Markdown</button>
        {onOpenWriting && <button onClick={() => onOpenWriting(targets.map((t) => t.en))}>去仿写</button>}
      </div>
      {lesson.outline.length > 0 && (
        <div className="golden-outline">
          {lesson.outline.map((sec) => (
            <div className="golden-sec" key={sec.paraId}>
              <b>{ROLE_LABEL[sec.role]}</b>
              {sec.points.map((p, i) => <span className="muted" key={i}>{p}</span>)}
            </div>
          ))}
        </div>
      )}
      <div className="golden-summary-list">
        {lesson.sentences.filter((s) => lesson.selected.includes(s.id)).map((s: GoldenSentence) => {
          const sentence = api.doc?.sentences.find((x) => x.id === s.id)
          const rec = api.progressFor(s.id)
          return (
            <div className="golden-summary-item" key={s.id}>
              <div className="golden-summary-head">
                <b>{s.id}</b>
                {isMastered(rec) ? <span className="golden-good">已掌握</span> : <span className="muted">待掌握</span>}
                <button onClick={() => sentence && onSpeak(sentence.text)}>🔊</button>
              </div>
              <div className="golden-en">{sentence?.text ?? ''}</div>
              {(s.zh || sentence?.translation) && <div className="muted">{s.zh ?? sentence?.translation}</div>}
              {s.pattern && <div className="golden-note">句型：{s.pattern}</div>}
              {s.tense && <div className="golden-note">时态：{s.tense}</div>}
              <div className="golden-targets">
                {s.targets.map((t, i) => (
                  <span key={i} className="golden-target"><b>{GOLDEN_TARGET_KIND_LABEL[t.kind]}</b> {t.en}{t.zh ? ` — ${t.zh}` : ''}</span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
