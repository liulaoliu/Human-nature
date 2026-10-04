import type { ChangeEvent, RefObject } from 'react'
import type { AnalysisTask } from '../../core/analyzer'

/** 「选词模式」里攒的待选生词。 */
export interface BatchItem {
  word: string
  sentence: string
  sentenceId: string | null
}

export interface SidePickProps {
  /** 选区任务按钮（翻译/查词/…）。 */
  tasks: { task: AnalysisTask; label: string }[]
  onPrompt: (task: AnalysisTask) => void
  lastTask: string | null

  /** 当前选中片段 / 是否用精确片段 / 选词模式提示。 */
  target: string
  useExact: boolean
  vocabMode: boolean
  canMark: boolean

  /** 待选清单。 */
  visibleBatch: BatchItem[]
  batchCount: number
  onRemoveWord: (b: BatchItem) => void
  onCommitBatch: () => void
  onCopyBatchPrompt: () => void
  onExportBatch: () => void
  onClearBatch: () => void
  onAddSelectionToBatch: () => void
  onMark: () => void

  /** 粘回与应用。 */
  pasted: string
  onPastedChange: (value: string) => void
  pasteReport: string[]
  pasteMissingCount: number
  onApplyPaste: () => void
  onCopyMissingAgain: () => void

  /** AI 工作包（agent 路径）。 */
  aiJobCount: number
  onExportAiJobs: () => void
  aiFileRef: RefObject<HTMLInputElement>
  onAiFile: (e: ChangeEvent<HTMLInputElement>) => void

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

  /** 混淆项 / 原形 / -ing-ed / 去重。 */
  confusableBatchCount: number
  confusableTodoCount: number
  onCopyConfusable: () => void
  confusableBatchSize: number
  onConfusableBatchSizeChange: (n: number) => void
  lemmaCount: number
  onCopyLemma: () => void
  posCount: number
  onCopyPos: () => void
  hasItems: boolean
  onDedupe: () => void
}

/** 选词 / 分析 Tab：选区任务、待选清单、粘回、AI 工作包、词库整理。 */
export default function SidePick({
  tasks,
  onPrompt,
  lastTask,
  target,
  useExact,
  vocabMode,
  canMark,
  visibleBatch,
  batchCount,
  onRemoveWord,
  onCommitBatch,
  onCopyBatchPrompt,
  onExportBatch,
  onClearBatch,
  onAddSelectionToBatch,
  onMark,
  pasted,
  onPastedChange,
  pasteReport,
  pasteMissingCount,
  onApplyPaste,
  onCopyMissingAgain,
  aiJobCount,
  onExportAiJobs,
  aiFileRef,
  onAiFile,
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
  confusableBatchCount,
  confusableTodoCount,
  onCopyConfusable,
  confusableBatchSize,
  onConfusableBatchSizeChange,
  lemmaCount,
  onCopyLemma,
  posCount,
  onCopyPos,
  hasItems,
  onDedupe,
}: SidePickProps) {
  return (
    <div className="side-sec" data-sec="pick">
      {visibleBatch.length > 0 && (
        <div className="picked batch">
          <div className="picked-head">
            <span className="tag exact">待选 {visibleBatch.length}</span>
            <span className="muted">点正文里的词可加 / 减</span>
          </div>
          <div className="chips">
            {visibleBatch.map((b) => (
              <button key={b.word} className="chipx" onClick={() => onRemoveWord(b)} title="点击移除">
                {b.word} ×
              </button>
            ))}
          </div>
          <div className="tasks">
            <button className="primary" onClick={onCommitBatch}>
              加入生词本
            </button>
            <button onClick={onCopyBatchPrompt}>复制查词提示词</button>
            <button onClick={onExportBatch}>导出 CSV</button>
            <button onClick={onClearBatch}>清空</button>
          </div>
          {batchCount > visibleBatch.length && (
            <div className="muted hint">
              另有 {batchCount - visibleBatch.length} 个已入库，不再显示（清空可重置）。
            </div>
          )}
        </div>
      )}

      <div className="picked">
        <div className="picked-head">
          <span className={'tag' + (useExact ? ' exact' : '')}>{useExact ? '精确片段' : '整句'}</span>
          <span className="word ellipsis" title={target}>
            {target || '（在正文里划选，或点一句）'}
          </span>
        </div>
        <div className="muted hint">
          {vocabMode
            ? '选词模式：点=一个词进待选；Ctrl 点多个词后右键或「加入待选」拼成词组；Alt 拖动=整段。'
            : '单击=整句；拖动=整段；Ctrl 点词=离散多选（点 bar 再点 from 就选这两个）。'}
        </div>
        <div className="tasks">
          <button
            className="primary"
            onClick={onAddSelectionToBatch}
            disabled={!canMark}
            title="把当前选中（Ctrl 点选拼成的词组）加入「待选」清单，之后统一查词"
          >
            加入待选
          </button>
          <button
            onClick={onMark}
            disabled={!canMark}
            title="不查词，直接把当前选中存进生词本（状态：未查），之后可用「补查音标」批量补齐"
          >
            直接入库（未查词）
          </button>
          {tasks.map((t) => (
            <button key={t.task} onClick={() => onPrompt(t.task)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="muted">
          {lastTask ? `上一个任务：${lastTask}` : '点任务 → 复制提示词 → 去 chat.deepseek.com'}
        </div>
      </div>

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
        <button
          onClick={onExportAiJobs}
          disabled={!aiJobCount}
          title="把当前所有待办（查词 / 混淆项 / 原形 / -ing-ed / 翻译 / 语言点 / 听力）打成一个 JSON，整包发出去"
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
            <button onClick={onRefreshWeb} title="数据变了就重新统计待办（会清零进度）">
              ↺ 刷新
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
      <button
        onClick={onCopyConfusable}
        disabled={!confusableBatchCount}
        style={{ marginTop: 6, marginLeft: 6 }}
        title="让 AI 为缺混淆项的词生成形近/义近干扰词（用于看词选义/词形辨析）；可分批，应用后再点继续"
      >
        🤖 生成混淆项（{confusableBatchCount}/{confusableTodoCount}）
      </button>
      <select
        value={String(confusableBatchSize)}
        onChange={(e) => onConfusableBatchSizeChange(Number(e.target.value))}
        style={{ marginTop: 6, marginLeft: 6 }}
        title="每次生成多少个词的混淆项（全部 = 一次生成，词多时 AI 回复可能被截断，截断的会留到下一批）"
      >
        <option value="30">30/批</option>
        <option value="60">60/批</option>
        <option value="100">100/批</option>
        <option value="200">200/批</option>
        <option value="0">全部/批</option>
      </select>
      <button
        onClick={onCopyLemma}
        disabled={!lemmaCount}
        style={{ marginTop: 6, marginLeft: 6 }}
        title="把疑似非原型的词（带来源语境）交给 AI 判断原形；结果粘到上面再点「应用结果」"
      >
        🔤 校正原形（{lemmaCount}）
      </button>
      <button
        onClick={onCopyPos}
        disabled={!posCount}
        style={{ marginTop: 6, marginLeft: 6 }}
        title="让 AI 逐个判断 -ing / -ed 形式在语境里的语法身份（谓语/非谓语/分词形容词…），结果粘回「应用结果」"
      >
        🔎 -ing/-ed 辨析（{posCount}）
      </button>
      <button
        onClick={onDedupe}
        disabled={!hasItems}
        style={{ marginTop: 6, marginLeft: 6 }}
        title="重算原形并按原形合并重复词条（程序处理，不经过 AI）"
      >
        🧹 去重整理
      </button>
    </div>
  )
}
