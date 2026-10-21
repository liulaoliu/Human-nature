import type { AnalysisTask } from '../../core/analyzer'
import SidePickAiPack, { type SidePickAiPackProps } from './SidePickAiPack'
import SidePickBatch, { type BatchItem, type SidePickBatchProps } from './SidePickBatch'
import SidePickDictTools, { type SidePickDictToolsProps } from './SidePickDictTools'

export type { BatchItem }

export interface SidePickProps extends SidePickBatchProps, SidePickDictToolsProps, SidePickAiPackProps {
  /** 选区任务按钮（翻译/查词/…）。 */
  tasks: { task: AnalysisTask; label: string }[]
  onPrompt: (task: AnalysisTask) => void
  lastTask: string | null

  /** 当前选中片段 / 是否用精确片段 / 选词模式提示。 */
  target: string
  useExact: boolean
  vocabMode: boolean
  canMark: boolean

  onAddSelectionToBatch: () => void
  onMark: () => void
  /** 手动加/改语言点。 */
  onOpenLang: () => void

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
  onOpenLang,
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
  dictReady,
  onRunAll,
  dictBusy,
  onPickFromDict,
  onEnrichFromDict,
  onFixLemmasFromDict,
  onConfuseFromDict,
  onEnrichExamples,
  examplesReady,
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
      <SidePickBatch
        visibleBatch={visibleBatch}
        batchCount={batchCount}
        onRemoveWord={onRemoveWord}
        onCommitBatch={onCommitBatch}
        onCopyBatchPrompt={onCopyBatchPrompt}
        onExportBatch={onExportBatch}
        onClearBatch={onClearBatch}
      />

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
          <button
            onClick={onOpenLang}
            disabled={!target}
            title="编辑这句的语言点（结构 / 语法 / 习语 / 词组 / 用法）：已有的会带出来，没有就是新增"
          >
            语言点
          </button>
        </div>
        <div className="muted">
          {lastTask ? `上一个任务：${lastTask}` : '点任务 → 复制提示词 → 去 chat.deepseek.com'}
        </div>
      </div>

      <SidePickDictTools
        dictReady={dictReady}
        onRunAll={onRunAll}
        dictBusy={dictBusy}
        onPickFromDict={onPickFromDict}
        onEnrichFromDict={onEnrichFromDict}
        onFixLemmasFromDict={onFixLemmasFromDict}
        onConfuseFromDict={onConfuseFromDict}
        examplesReady={examplesReady}
        onEnrichExamples={onEnrichExamples}
      />

      <SidePickAiPack
        pasted={pasted}
        onPastedChange={onPastedChange}
        pasteReport={pasteReport}
        pasteMissingCount={pasteMissingCount}
        onApplyPaste={onApplyPaste}
        onCopyMissingAgain={onCopyMissingAgain}
        aiJobCount={aiJobCount}
        aiScope={aiScope}
        onAiScopeChange={onAiScopeChange}
        autoVocabDirect={autoVocabDirect}
        onAutoVocabDirectChange={onAutoVocabDirectChange}
        autoVocabDoneHere={autoVocabDoneHere}
        onRerunAutoVocab={onRerunAutoVocab}
        onExportAiJobs={onExportAiJobs}
        aiFileRef={aiFileRef}
        onAiFile={onAiFile}
        localConfigured={localConfigured}
        localRunning={localRunning}
        localDone={localDone}
        localTotal={localTotal}
        localRound={localRound}
        localPhase={localPhase}
        localError={localError}
        onRunLocal={onRunLocal}
        checklist={checklist}
        checklistDone={checklistDone}
        checklistTotal={checklistTotal}
        nextHint={nextHint}
        onSkipPending={onSkipPending}
        aiWebBatchSize={aiWebBatchSize}
        onAiWebBatchSizeChange={onAiWebBatchSizeChange}
        onCopyWebPrompt={onCopyWebPrompt}
        onCopyWebMissing={onCopyWebMissing}
        onRefreshWeb={onRefreshWeb}
        webTotal={webTotal}
        webDone={webDone}
        webPending={webPending}
        webMissing={webMissing}
        webPendingLabels={webPendingLabels}
        webBreakdown={webBreakdown}
      />

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
