import { useState } from 'react'
import type { IntensivePlan, IntensiveStageKey } from '../../core/intensive'
import type { OutputBoard } from '../../core/output'

export type DrillKind = 'memory' | 'chunk' | 'deep' | 'mark' | 'grammar' | 'listen'

export interface IntensivePanelProps {
  onClose: () => void
  articleTitle: string
  hasDoc: boolean
  plan: IntensivePlan
  /** 「已通读（看懂大意）」的勾选状态 */
  skimmed: boolean
  onToggleSkimmed: () => void
  /** 主按钮：跑一键跑批（补词/句/语言点） */
  onRunBatch: () => void
  /** 一键跑批进行中：进度（第几轮 / 阶段 / done/total）与错误。 */
  batchRunning: boolean
  batchRound: number
  batchPhase: string
  batchDone: number
  batchTotal: number
  batchError: string
  /** 产出看板（词块/仿写/复述的量化）。 */
  board: OutputBoard
  /** 本篇复述记录。 */
  retells: { at: string; text: string; words: number }[]
  onSaveRetell: (text: string) => void
  onDeleteRetell: (at: string) => void
  /** 阶段行右侧按钮：按阶段跳到对应工具 */
  onStage: (key: IntensiveStageKey) => void
  /** 快捷「拷打」 */
  onDrill: (kind: DrillKind) => void
  /** 「错题包围战」：错题 + 优先 + 学不稳 一起围剿（打到全对）。 */
  onSiege: () => void
}

const STATUS_TEXT: Record<string, string> = { todo: '未开始', doing: '进行中', done: '已完成' }

/**
 * 精读工作流面板：把「通读 → 查词 → 词块 → 句子 → 拷打 → 产出 → 语法」串成一条流水线，
 * 按当前数据实时显示进度与下一步，并一键跳到对应工具。
 */
export default function IntensivePanel({
  onClose,
  articleTitle,
  hasDoc,
  plan,
  skimmed,
  onToggleSkimmed,
  onRunBatch,
  batchRunning,
  batchRound,
  batchPhase,
  batchDone,
  batchTotal,
  batchError,
  board,
  retells,
  onSaveRetell,
  onDeleteRetell,
  onStage,
  onDrill,
  onSiege,
}: IntensivePanelProps) {
  const [retellDraft, setRetellDraft] = useState('')
  // 跑批进行中：整个面板的动作先锁住，避免重复提交 / 中途切会话。
  const busy = batchRunning
  const batchLabel = busy
    ? `⏳ 第 ${batchRound} 轮 · ${batchPhase || '处理中'} ${batchDone}/${batchTotal}`
    : '⚡ 一键跑批'
  return (
    <div className="plan-overlay" onClick={onClose}>
      <div className="plan-panel intensive-panel" onClick={(e) => e.stopPropagation()}>
        <div className="bar plan-head">
          <b>🎯 精读工作流</b>
          <span className={'ilevel ilevel-' + plan.level}>{plan.levelLabel}</span>
          <span className="muted">总进度 {plan.progress}%</span>
          <button onClick={onClose}>关闭</button>
        </div>
        {articleTitle && <div className="muted intensive-art">当前：{articleTitle}</div>}
        {busy && (
          <div className="intensive-run" title="正在跑，请等这一步结束；重复点击不会再启动一轮">
            {batchLabel}
            <span className="muted">（跑批中：按钮已锁，重复点击不会重跑）</span>
          </div>
        )}
        {batchError && !busy && <div className="intensive-err">跑批出错：{batchError}</div>}

        <div className="intensive-next">
          <div className="intensive-next-head">
            <span className="muted">下一步</span>
            <b>{plan.nextLabel}</b>
          </div>
          <div className="muted intensive-next-hint">{plan.nextHint}</div>
          <div className="bar">
            <button
              className="primary"
              onClick={() => (plan.nextKey ? onStage(plan.nextKey) : onRunBatch())}
              disabled={!hasDoc || busy}
            >
              {busy ? batchLabel : plan.nextKey ? '开始这一步' : '一键跑批'}
            </button>
            <button
              onClick={onRunBatch}
              disabled={!hasDoc || busy}
              title="补齐音标/释义/例句/词组/习语/语法标记/翻译/语言点；跑批中不可重复点"
            >
              {batchLabel}
            </button>
            <span className="muted">深度：{plan.levelDesc}</span>
          </div>
        </div>

        <div className="isekf">
          <label className="check-inline" title="速读过一遍、能看懂大意就勾上">
            <input type="checkbox" checked={skimmed} onChange={onToggleSkimmed} />
            已通读（看懂大意）
          </label>
        </div>

        <div className="iboard">
          <div className="iboard-head">
            <b>📊 产出看板</b>
            <span className={'ilevel ilevel-' + (board.score >= 75 ? 3 : board.score >= 50 ? 2 : board.score >= 25 ? 1 : 0)}>
              {board.grade}
            </span>
            <span className="muted">产出分 {board.score}</span>
          </div>
          <div className="iboard-rows">
            {board.rows.map((r) => (
              <div className={'ibrow' + (r.good ? ' good' : '')} key={r.key}>
                <span className="ibrow-label">{r.label}</span>
                <span className="ibrow-value">{r.value}</span>
                <span className="ibar ibrow-bar">
                  <i style={{ width: r.level + '%' }} />
                </span>
                <span className="muted ibrow-detail">{r.detail}</span>
              </div>
            ))}
          </div>
          <div className="muted iboard-next">下一步：{board.next}</div>
        </div>

        <div className="istages">
          {plan.stages.map((s) => (
            <div className={'istage istage-' + s.status} key={s.key}>
              <div className="istage-main">
                <div className="istage-label">
                  <span className="istage-emoji">{s.emoji}</span>
                  <b>{s.label}</b>
                  <span className={'istage-badge istage-badge-' + s.status}>{STATUS_TEXT[s.status]}</span>
                </div>
                <div className="muted istage-detail">{s.detail}</div>
                <div className="ibar">
                  <i style={{ width: s.progress + '%' }} />
                </div>
              </div>
              <div className="istage-side">
                <span className="muted">{s.progress}%</span>
                <button onClick={() => onStage(s.key)} disabled={!s.enabled || busy}>
                  {s.action}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="idrills">
          <b>快速拷打（只针对本篇）</b>
          <div className="idrill-row">
            <span className="muted">词 · 搭配</span>
            <button onClick={() => onDrill('memory')} disabled={!hasDoc || busy} title="拼写 + 看词选义 + 词形辨析：把词变成长期记忆">
              🥊 记忆拷打
            </button>
            <button onClick={() => onDrill('chunk')} disabled={!hasDoc || busy} title="搭配填空 + 例句填空 + 搭配默写 + 介词填空 + 习语填空：逼你把词组用出来">
              🧩 词块拷打
            </button>
            <button onClick={() => onDrill('deep')} disabled={!hasDoc || busy} title="英英释义 → 写单词 / 选单词：用英文理解英文，记得更牢">
              🇬🇧 英英释义
            </button>
            <button onClick={() => onDrill('mark')} disabled={!hasDoc || busy} title="判断可数/不可数、及物/不及物、可分级/不可分级">
              🏷 语法标记
            </button>
          </div>
          <div className="idrill-row">
            <span className="muted">句 · 语法 · 听</span>
            <button onClick={() => onDrill('grammar')} disabled={!hasDoc || busy} title="中译英 + 结构/语法 + 功能词 + 排序：练语态时态与句式">
              🧠 语法·结构
            </button>
            <button onClick={() => onDrill('listen')} disabled={!hasDoc || busy} title="听力填空：听音填词，检验听力">
              🎧 听力拷打
            </button>
          </div>
          <div className="idrill-row">
            <span className="muted">总攻</span>
            <button
              className="danger"
              onClick={onSiege}
              disabled={busy}
              title="把错题本 + 优先重排 + 学不稳的词一起拉出来混编轰炸，自动「反复鞭打」直到全对"
            >
              🧨 错题包围战（打到全对）
            </button>
          </div>
          <div className="muted intensive-tip">
            拷打只针对<b>本篇</b>的词/句；答对会推进该词的 SRS，答错进错题本。隔天再回「背单词」清到期即可。
          </div>
        </div>

        <div className="iretell">
          <b>✍️ 复述打卡（用自己的话讲一遍）</b>
          <textarea
            className="iretell-input"
            rows={3}
            value={retellDraft}
            placeholder="用中文或英文，把这段大意讲出来（3–5 句）。能说出来才算真懂 —— 记一条就计入看板。"
            onChange={(e) => setRetellDraft(e.target.value)}
          />
          <div className="bar">
            <button
              className="primary"
              disabled={!retellDraft.trim()}
              onClick={() => {
                onSaveRetell(retellDraft)
                setRetellDraft('')
              }}
            >
              保存复述
            </button>
            <span className="muted">已记录 {retells.length} 条</span>
          </div>
          {retells.slice(0, 3).map((r) => (
            <div className="iretell-item" key={r.at}>
              <span className="muted">{r.at.slice(5, 16).replace('T', ' ')} · {r.words} 词</span>
              <span className="iretell-text">{r.text}</span>
              <button onClick={() => onDeleteRetell(r.at)} title="删除这条复述">
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
