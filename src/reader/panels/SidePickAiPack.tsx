import type { ChangeEvent, RefObject } from 'react'
import { AI_BATCH_NAME } from '../labels'

export interface SidePickAiPackProps {
  /** 粘回与应用。 */
  pasted: string
  onPastedChange: (value: string) => void
  pasteReport: string[]
  pasteMissingCount: number
  onApplyPaste: () => void
  onCopyMissingAgain: () => void

  /** AI 工作包（agent 路径）。 */
  aiJobCount: number
  aiScope: 'article' | 'all'
  onAiScopeChange: (scope: 'article' | 'all') => void
  /** 自动标词是否直接进生词本（跳过待选）。 */
  autoVocabDirect: boolean
  onAutoVocabDirectChange: (v: boolean) => void
  /** 本篇是否已「自动标过词」（标过就不再进待办）+ 重跑。 */
  autoVocabDoneHere: boolean
  onRerunAutoVocab: () => void
  onExportAiJobs: () => void
  aiFileRef: RefObject<HTMLInputElement>
  onAiFile: (e: ChangeEvent<HTMLInputElement>) => void

  /** 一键跑批（服务端直连；key 在服务端，不经过网页/命令行）。 */
  localConfigured: boolean | null
  localRunning: boolean
  localDone: number
  localTotal: number
  localRound: number
  localPhase: string
  localError: string
  onRunLocal: () => void

  /** 待办检查 / 进度提醒。 */
  checklist: { key: string; label: string; done: number; total: number; manual?: boolean }[]
  checklistDone: number
  checklistTotal: number
  nextHint: string
  /** 把当前待办标记为已处理/跳过（用于个别补不齐、反复失败的词）。 */
  onSkipPending: () => void

  /** AI 工作包（网页版 / DeepSeek 路径）。 */
  aiWebBatchSize: number
  onAiWebBatchSizeChange: (n: number) => void
  onCopyWebPrompt: () => void
  onCopyWebMissing: () => void
  onRefreshWeb: () => void
  webTotal: number
  webDone: number
  webPending: number
  webMissing: number
  webPendingLabels: string[]
  webBreakdown: { task: string; label: string; done: number; total: number }[]
}

/** AI 工作包：粘回结果、范围/直接入库开关、一键跑批、网页版分批提示词与进度。 */
export default function SidePickAiPack({
  pasted,
  onPastedChange,
  pasteReport,
  pasteMissingCount,
  onApplyPaste,
  onCopyMissingAgain,
  aiJobCount,
  aiScope,
  onAiScopeChange,
  autoVocabDirect,
  onAutoVocabDirectChange,
  autoVocabDoneHere,
  onRerunAutoVocab,
  onExportAiJobs,
  aiFileRef,
  onAiFile,
  localConfigured,
  localRunning,
  localDone,
  localTotal,
  localRound,
  localPhase,
  localError,
  onRunLocal,
  checklist,
  checklistDone,
  checklistTotal,
  nextHint,
  onSkipPending,
  aiWebBatchSize,
  onAiWebBatchSizeChange,
  onCopyWebPrompt,
  onCopyWebMissing,
  onRefreshWeb,
  webTotal,
  webDone,
  webPending,
  webMissing,
  webPendingLabels,
  webBreakdown,
}: SidePickAiPackProps) {
  return (
    <>
      <textarea
        className="paste"
        placeholder="把 DeepSeek 的结果粘回这里，再点「应用结果」"
        value={pasted}
        onChange={(e) => onPastedChange(e.target.value)}
      />
      <div className="ai-pack">
        <div className="muted">
          ⚡ 一键打包：导出待办文件 → 整包交给 AI（网页版也行，喂给本机 agent 更快）→ 把结果 JSON 导回，一次应用全部，不用一条条复制粘贴。
        </div>
        {checklist.length > 0 && (
          <div className="ai-check">
            <div className="muted">
              📋 待办检查 · 进度 <b>{checklistDone}</b>/{checklistTotal}
              {checklistTotal > 0 && checklistDone >= checklistTotal ? ' 🎉' : ''}
            </div>
            <div className="ai-check-list">
              {checklist.map((it) => {
                const ok = it.total > 0 && it.done >= it.total
                return (
                  <div
                    key={it.key}
                    className={'ai-check-row' + (ok ? ' done' : '') + (it.manual ? ' manual' : '')}
                  >
                    <span className="ai-check-name">
                      {it.manual ? '👤 ' : ''}
                      {it.label}
                    </span>
                    <span className="muted">
                      {it.done}/{it.total}
                    </span>
                    <span className="ai-check-mark">{ok ? '✔' : it.manual ? '待处理' : ''}</span>
                  </div>
                )
              })}
            </div>
            {nextHint && <div className="muted ai-next">👉 {nextHint}</div>}
            {webPending > 0 && (
              <button
                className="ai-skip"
                onClick={() => {
                  if (
                    window.confirm(
                      `把当前 ${webPending} 项待办标记为「已处理/跳过」？\n\n` +
                        `不改动词库数据，只是不再提示（数据再变时可能重新出现）。\n` +
                        `适合个别补不齐、反复失败的词。`,
                    )
                  )
                    onSkipPending()
                }}
                title="标记为已处理，不再提示"
              >
                ⏭ 跳过这 {webPending} 项
              </button>
            )}
          </div>
        )}
        <div className="ai-scope">
          <span className="muted">范围</span>
          <button className={aiScope === 'article' ? 'primary' : ''} onClick={() => onAiScopeChange('article')} title="只处理这篇的生词 / 翻译 / 语言点">
            本篇
          </button>
          <button className={aiScope === 'all' ? 'primary' : ''} onClick={() => onAiScopeChange('all')} title="处理整个词库（补齐 / 混淆项等会覆盖所有生词）">
            全库
          </button>
        </div>
        {aiScope === 'all' && (
          <div className="ai-scope-warn">
            ⚠️ 全库范围：会处理整个生词本（当前 {webPending} 项待办），不只是本篇——词库大时又慢又费 token。
          </div>
        )}
        <label
          className="ai-direct"
          title={`开启后：自动标词挑出的词直接写进生词本（跳过「待选」），下次${AI_BATCH_NAME}再自动补音标/释义`}
        >
          <input
            type="checkbox"
            checked={autoVocabDirect}
            onChange={(e) => onAutoVocabDirectChange(e.target.checked)}
          />
          自动标词直接进生词本（跳过待选）
        </label>
        {autoVocabDoneHere && (
          <div className="ai-direct-done">
            <span className="muted">本篇「自动标词」已做过（不再自动进待办）</span>
            <button onClick={onRerunAutoVocab} title={`清掉本篇「已标词」标记，让${AI_BATCH_NAME}重新标词`}>
              🔄 重跑自动标词
            </button>
          </div>
        )}
        <button
          onClick={onExportAiJobs}
          disabled={!aiJobCount}
          title="把当前所有待办（自动标词 / 查词 / 混淆项 / 原形 / -ing-ed / 翻译 / 语言点 / 听力）打成一个 JSON，整包发出去"
        >
          📦 导出 AI 工作包（{aiJobCount} 项）
        </button>
        <button
          onClick={() => aiFileRef.current?.click()}
          style={{ marginLeft: 6 }}
          title="导入 AI 返回的结果 JSON（{ results: [{ id, raw }] }），按任务逐条应用并汇总回执"
        >
          📥 导入 AI 结果
        </button>
        <input ref={aiFileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={onAiFile} />

        <div className="ai-local">
          <button
            className="primary"
            onClick={onRunLocal}
            disabled={!webPending || localRunning || localConfigured === false}
            title={
              localConfigured === false
                ? '服务端未配置 API key：把 key 填进 config.local.json（该文件已 gitignore）'
                : '把待办直接发给本机服务端跑，跑完自动应用；会自动串联多轮（如：先选词进生词本，再自动补音标/释义），不用复制粘贴、不用命令行'
            }
          >
            {localRunning ? `⚡ ${AI_BATCH_NAME} · 第 ${localRound} 轮 · ${localPhase || '处理中'} ${localDone}/${localTotal}` : `⚡ ${AI_BATCH_NAME}（${webPending} 项）`}
          </button>
          {localConfigured === false && <span className="muted"> 未配置 key（config.local.json）</span>}
          {localError && <span className="web-miss"> · {localError}</span>}
        </div>

        <div className="ai-web">
          <div className="muted">
            网页版（DeepSeek 等）：复制提示词 → 网页粘贴 → 整段回复贴回上面的框 → 应用。
            翻译 / 语言点已按句分块，避免一次太多被截断。
          </div>

          <div className="web-progress">
            {webTotal === 0 ? (
              <span className="muted">当前没有待办</span>
            ) : webPending === 0 ? (
              <span className="web-done">🎉 全部完成（{webDone}/{webTotal}）</span>
            ) : (
              <span>
                进度 <b>{webDone}</b>/{webTotal} · 还要做 <b>{webPending}</b>
                {webMissing > 0 && <span className="web-miss"> · 缺项 {webMissing}</span>}
              </span>
            )}
          </div>
          {webBreakdown.length > 0 && (
            <div className="web-flow">
              {webBreakdown.map((g) => (
                <div key={g.task} className={'web-flow-row' + (g.done === g.total ? ' done' : '')}>
                  <span className="web-flow-name">{g.label}</span>
                  <span className="muted">
                    {g.done}/{g.total}
                  </span>
                  <span className="web-flow-mark">{g.done === g.total ? '✔' : ''}</span>
                </div>
              ))}
            </div>
          )}
          {webPending > 0 && webPendingLabels.length > 0 && (
            <div className="muted web-pending">
              还要做：{webPendingLabels.join('、')}
              {webPending > webPendingLabels.length ? ` …共 ${webPending} 项` : ''}
            </div>
          )}

          <button
            onClick={onCopyWebPrompt}
            disabled={webPending === 0}
            title="复制「下一批还没做」的任务；已完成的会自动跳过"
          >
            📋 复制下一批提示词（{webPending} 项待做）
          </button>
          <select
            value={String(aiWebBatchSize)}
            onChange={(e) => onAiWebBatchSizeChange(Number(e.target.value))}
            style={{ marginLeft: 6 }}
            title="每批几个任务（网页端回复容易截断，分批更稳）"
          >
            <option value="4">4/批</option>
            <option value="6">6/批</option>
            <option value="8">8/批</option>
            <option value="12">12/批</option>
            <option value="0">全部/批</option>
          </select>
          <div className="muted web-pending">
              复制一批 → 网页问一次 → 把回复整段贴到上面的框 → 点「应用结果」。
          </div>
          <div className="bar" style={{ marginTop: 6 }}>
            {webMissing > 0 && (
              <button onClick={onCopyWebMissing} title="只重发「问过但没成功」的项">
                🔁 重发缺项 {webMissing}
              </button>
            )}
            <button
              onClick={() => {
                if (window.confirm('重置进度？\n已应用的成果不会删除；但所有待办会重新显示为「未做」。')) onRefreshWeb()
              }}
              title="清空进度（不删成果数据）；所有待办重新显示为未做"
            >
              ↺ 重置进度
            </button>
          </div>
        </div>
      </div>
      <button className="primary" onClick={onApplyPaste} disabled={!pasted.trim()} style={{ marginTop: 6 }}>
        应用结果
      </button>
      {pasteReport.length > 0 && (
        <div className="paste-report">
          {pasteReport.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
      {pasteMissingCount > 0 && (
        <button
          onClick={onCopyMissingAgain}
          style={{ marginTop: 6 }}
          title="把 AI 没返回的词重新组成提示词，复制后再贴回"
        >
          🔁 复制未返回的 {pasteMissingCount} 个
        </button>
      )}
    </>
  )
}
