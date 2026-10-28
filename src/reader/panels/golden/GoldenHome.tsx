import type { GoldenBankActions, GoldenExamApi, GoldenHomeApi } from './types'

export default function GoldenHome({
  api,
  onGenerate,
  bank,
  exam,
  onOpenBank,
}: {
  api: GoldenHomeApi
  onGenerate?: () => void
  bank?: GoldenBankActions
  exam?: GoldenExamApi
  onOpenBank: () => void
}) {
  const selected = api.lesson?.selected.length ?? 0
  const summary = api.summary
  const step2Done = selected > 0 && api.ordered.every((s) => api.progressFor(s.id)?.summarySeen === true)
  const nextDrill = api.ordered.findIndex((s) => api.progressFor(s.id)?.summarySeen !== true)
  const bankCount = bank?.rows.length ?? 0
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
        {exam && (
          <button
            className="golden-step"
            onClick={() => {
              exam.start()
              api.setView('exam')
            }}
            disabled={!exam.unlocked}
            title={exam.unlocked ? '用学过的句型仿写新句子，AI 批改' : `完成 ${exam.after} 句遣词造句后解锁`}
          >
            <span className="golden-step-no">🎓</span>
            <span>
              <b>仿写考试</b>
              <small>
                {exam.unlocked
                  ? `中文提示 + 目标结构，写新句子（已完成 ${exam.completedCount} 句）`
                  : `完成 ${exam.after} 句解锁（当前 ${exam.completedCount} 句）`}
              </small>
            </span>
            <span className="golden-step-go">→</span>
          </button>
        )}
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
