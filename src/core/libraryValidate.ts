/**
 * 词库**不变量校验**（纯函数）。
 *
 * 为什么要有它：数据是唯一资产，但「结构对不对」以前只靠类型系统（运行时挡不住导入的 JSON、
 * 手改的库、老版本残留）。这里把不变量写成可执行断言，用在三处：
 *   1. 单测：夹具库、迁移结果、找回工具产出的文件都必须过；
 *   2. 迁移后自检：`migrateLibrary` 的结果不该有 error；
 *   3. 排查数据问题时，一条命令看出问题在哪。
 *
 * 级别：`error` = 结构坏了（我们的代码依赖它，必须修）；`warn` = 可疑但不致命。
 */
import type { VocabItem, VocabLibrary } from '../types/document'
import { KIND_ORDER } from './entryKind'

export interface LibraryIssue {
  level: 'error' | 'warn'
  /** 出问题的词条 id（库级问题为空） */
  id?: string
  message: string
}

const KINDS = new Set<string>(KIND_ORDER)
const STATUSES = new Set(['unqueried', 'queried', 'edited', 'mastered'])
const ISO = /^\d{4}-\d{2}-\d{2}T/

function checkItem(it: VocabItem, seenIds: Set<string>, seenLemmas: Set<string>, out: LibraryIssue[]): void {
  const push = (level: 'error' | 'warn', message: string) => out.push({ level, id: it.id, message })
  if (!it.id) push('error', '缺少 id')
  else if (seenIds.has(it.id)) push('error', `id 重复：${it.id}`)
  else seenIds.add(it.id)
  if (!it.word?.trim()) push('error', 'word 为空')
  if (!it.lemma?.trim()) push('error', 'lemma 为空')
  else if (seenLemmas.has(it.lemma)) push('error', `lemma 重复：${it.lemma}（去重没生效）`)
  else seenLemmas.add(it.lemma)
  if (it.kind !== undefined && !KINDS.has(it.kind)) push('error', `kind 非法：${String(it.kind)}`)
  if (!STATUSES.has(it.status)) push('error', `status 非法：${String(it.status)}`)
  if (it.id && it.lemma && it.id !== `vocab:${it.lemma}`) push('warn', 'id 与 lemma 不一致（改名后没同步？）')
  if (!Array.isArray(it.examples)) push('error', 'examples 不是数组')
  if (it.examples?.some((e) => !e?.text?.trim())) push('warn', '有例句缺少 text')
  if (it.source && !it.source.articleId?.trim()) push('warn', 'source.articleId 为空')
  if (it.contexts?.some((c) => !c?.articleId?.trim())) push('warn', '有语境缺少 articleId')
  if (!ISO.test(it.createdAt) || Number.isNaN(Date.parse(it.createdAt))) push('error', `createdAt 不是 ISO：${it.createdAt}`)
  if (!ISO.test(it.updatedAt) || Number.isNaN(Date.parse(it.updatedAt))) push('error', `updatedAt 不是 ISO：${it.updatedAt}`)
  const rs = it.reviewState
  if (!rs || typeof rs.ease !== 'number' || typeof rs.interval !== 'number' || typeof rs.repetitions !== 'number') {
    push('error', 'reviewState 结构不对')
  } else if (rs.due !== null && Number.isNaN(Date.parse(rs.due))) {
    push('warn', `reviewState.due 不是 ISO：${String(rs.due)}`)
  }
}

/** 校验整个词库；返回所有问题（空数组 = 干净）。 */
export function validateLibrary(library: unknown): LibraryIssue[] {
  const out: LibraryIssue[] = []
  if (!library || typeof library !== 'object') return [{ level: 'error', message: '词库不是对象' }]
  const o = library as Partial<VocabLibrary>
  if (typeof o.schemaVersion !== 'number') out.push({ level: 'error', message: 'schemaVersion 缺失' })
  if (!Array.isArray(o.items)) return [...out, { level: 'error', message: 'items 不是数组' }]
  const seenIds = new Set<string>()
  const seenLemmas = new Set<string>()
  for (const it of o.items) checkItem(it as VocabItem, seenIds, seenLemmas, out)
  if (o.articleEntries !== undefined) {
    if (!Array.isArray(o.articleEntries)) out.push({ level: 'error', message: 'articleEntries 不是数组' })
    else {
      const seen = new Set<string>()
      for (const e of o.articleEntries) {
        if (!e || typeof e !== 'object') {
          out.push({ level: 'error', message: 'articleEntries 有非对象条目' })
          continue
        }
        if (!e.articleId?.trim()) out.push({ level: 'error', message: 'articleEntries 有条目缺 articleId' })
        if (!e.lemma?.trim()) out.push({ level: 'error', message: 'articleEntries 有条目缺 lemma' })
        else if (!seenLemmas.has(e.lemma)) out.push({ level: 'error', message: `articleEntries 指向不存在的词：${e.lemma}` })
        const k = `${e.articleId}\u0000${e.lemma}`
        if (seen.has(k)) out.push({ level: 'error', message: `articleEntries 重复：${e.articleId} / ${e.lemma}` })
        seen.add(k)
        if (e.origin !== 'auto' && e.origin !== 'manual') out.push({ level: 'error', message: `articleEntries origin 非法：${String(e.origin)}` })
        if (!e.addedAt || Number.isNaN(Date.parse(e.addedAt))) out.push({ level: 'error', message: 'articleEntries addedAt 不是 ISO' })
      }
    }
  }
  return out
}

/** 只要「致命问题」（测试里断言用）。 */
export function libraryErrors(library: unknown): LibraryIssue[] {
  return validateLibrary(library).filter((i) => i.level === 'error')
}
