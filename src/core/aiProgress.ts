import { AI_TASK_LABEL, type AiJob, type AiJobTask } from './aiJobTypes'

/** AI 待办面板的纯派生：分组、清单、下一步提示。 */

export interface AiBreakdownItem {
  task: AiJobTask
  label: string
  done: number
  total: number
}

/** 按任务类型分组；顺序按首次出现，完成数按 id 集合算。 */
export function buildAiBreakdown(round: readonly AiJob[], doneSet: ReadonlySet<string>): AiBreakdownItem[] {
  const order: AiJobTask[] = []
  const map = new Map<AiJobTask, AiBreakdownItem>()
  for (const j of round) {
    let g = map.get(j.task)
    if (!g) {
      g = { task: j.task, label: AI_TASK_LABEL[j.task] ?? j.task, done: 0, total: 0 }
      map.set(j.task, g)
      order.push(j.task)
    }
    g.total++
    if (doneSet.has(j.id)) g.done++
  }
  return order.map((t) => map.get(t)!)
}

export interface AiChecklistItem {
  key: string
  label: string
  done: number
  total: number
  manual?: boolean
}

/** AI 进度 + 人工跟进步骤合成一张清单。 */
export function buildAiChecklist(breakdown: readonly AiBreakdownItem[], batchCount: number): AiChecklistItem[] {
  const items: AiChecklistItem[] = breakdown.map((g) => ({
    key: g.task,
    label: g.label,
    done: g.done,
    total: g.total,
  }))
  if (batchCount > 0) {
    items.push({ key: 'commitBatch', label: `待选入库（${batchCount} 词）`, done: 0, total: 1, manual: true })
  }
  return items
}

export interface AiNextHintInput {
  batchCount: number
  running: boolean
  round: number
  phase: string
  done: number
  total: number
  pending: readonly AiJob[]
  roundCount: number
  autoVocabDone: boolean
  batchName: string
}

/**
 * 下一步该干嘛。
 * 「待办」按 pending（还没试过的）算——试过一次的即使没补全也不再重复排队（否则会无限重跑）；
 * 若所有都试过但数据仍有缺口（多半是模型没返回），另给一行提示，引导用离线「补齐生词本」。
 */
export function aiNextHint(input: AiNextHintInput): string {
  if (input.batchCount > 0) {
    return `待选有 ${input.batchCount} 个词还没进生词本：先点「加入生词本」，再跑一次批处理补齐音标/释义。`
  }
  if (input.running) {
    return `${input.batchName}中… 第 ${input.round} 轮 · ${input.phase || '处理中'}（${input.done}/${input.total}）`
  }
  if (input.pending.length > 0) {
    const tasks = [...new Set(input.pending.map((j) => AI_TASK_LABEL[j.task] ?? j.task))]
    const words: string[] = []
    for (const j of input.pending) for (const w of j.askedWords) if (!words.includes(w)) words.push(w)
    const w = words.length ? `（${words.slice(0, 6).join('、')}${words.length > 6 ? '…' : ''}）` : ''
    return `还有 ${input.pending.length} 项待办【${tasks.join('、')}】${w}，可点「⚡ ${input.batchName}」。`
  }
  if (input.roundCount > 0) {
    return `本轮已跑完；还有 ${input.roundCount} 项没补全（多半是模型没返回这些词）：可点「📖 补齐生词本」（离线），或删掉不需要的词。`
  }
  if (input.autoVocabDone) {
    return '本篇已「自动标过词」，所以不再生成标词待办；想重新标词点「↺ 重置自动标词」，或改用「📖 离线挑超纲词」。'
  }
  return '本篇待办已全部完成 🎉'
}
