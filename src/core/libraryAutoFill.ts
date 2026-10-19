/**
 * 词库「自动补全」的**唯一写入口**（单写者策略 + 纯函数计划）。
 *
 * ## 为什么需要这个模块
 * 之前是「离线例句补全」和「语言点收藏」两个 effect 各自：读词库 → 算 → 写词库。
 * 两个 effect 在同一个渲染里跑，都从**同一份快照**出发，谁后写谁覆盖前一个的改动；
 * 一旦某处再基于旧快照重算，就会变成「你加我删」的来回跳（踩坑 #1，见 docs/TESTING.md）。
 *
 * 现在把「该补什么」全部收成一个**纯函数**：输入当前词库 + 素材，输出下一个词库；
 * React 层只有一个 effect 调它、只写一次。想再加自动补全的东西，就往这里加一格，
 * 而不是再写一个 effect —— 这条是硬约定。
 *
 * 纯函数 ⇒ 可以用单测直接证明「跑两遍结果一样、不同顺序结果一样、不丢改动」。
 */
import type { VocabItem, VocabLibrary } from '../types/document'
import { applyExamples, applyLemmaMap, dedupeLibrary, pickOfflineExamples } from './vocab'
import { langPointSignature, upsertLanguagePoints, type LanguagePoint } from './langPoints'
import { dictLemmaPairs, type Ecdict } from './ecdict'

/** 离线例句查询（装了离线库才给；返回候选例句）。 */
export interface OfflineExampleLookup {
  lookup: (item: VocabItem) => { text: string; translation?: string }[]
}

export interface AutoFillSources {
  /** 语言点收藏：所有待收条目（来自当前文章 + 已保存文章） */
  langPoints: LanguagePoint[]
  /** 每篇文章已收过的语言点签名（`reader:langCollected`） */
  collected: Record<string, string>
  /** 离线例句（Tatoeba）；没装/没就绪就别给 */
  offline?: OfflineExampleLookup
  /**
   * 离线词典算出的词形归并（非原型 → 原型）。
   * 必须在收藏语言点**之前**做：先合并同根词，避免语言点又建出重复条目。
   */
  lemmaPairs?: { from: string; to: string }[]
  /** 离线词典已就绪时直接给；内部会反复归并到稳定（处理多跳词形）。 */
  dict?: Ecdict | null
}

export interface AutoFillResult {
  library: VocabLibrary
  /** 更新后的「已收签名」（调用方按需落盘） */
  collected: Record<string, string>
  /** 这次实际补了什么（日志 / 测试断言用） */
  applied: { lemmaFixes: number; langPoints: number; offlineExamples: number }
  /** 词库一个字都没动 → 调用方跳过写库 */
  libraryUntouched: boolean
  /** 签名表也没变 */
  collectedUntouched: boolean
}

/**
 * 收集「还缺离线例句」的词（供自动补全与手动按钮共用，避免两处各写一份）。
 * 返回的每项都带 `pickOfflineExamples` 过滤后的例句（已去掉重复与超上限）。
 */
export function collectOfflineExampleRows(
  items: VocabItem[],
  lookup: (item: VocabItem) => { text: string; translation?: string }[],
): { word: string; examples: { text: string; translation?: string }[] }[] {
  const rows: { word: string; examples: { text: string; translation?: string }[] }[] = []
  for (const it of items) {
    if (!it.meaning) continue
    const add = pickOfflineExamples(it, lookup(it))
    if (add.length) rows.push({ word: it.word, examples: add })
  }
  return rows
}

/**
 * 算一次「该补什么」。**不做任何 IO**，调用方拿着结果写一次库。
 * 顺序固定：先语言点收藏（会把新条目建出来），再给「有释义但例句不够」的词补离线例句。
 */
export function autoFillLibrary(
  library: VocabLibrary,
  sources: AutoFillSources,
  now: Date = new Date(),
): AutoFillResult {
  let lib = library
  let collected = sources.collected
  let collectedChanged = false
  let lemmaFixes = 0
  let langPoints = 0

  // 0) 词形归并：非原型合并到词典原形（跳过手动改过/已掌握的词）
  if (sources.dict) {
    // 词典可能是多跳的（algaes → algae → alga），循环到稳定；最多 5 轮防病态循环。
    for (let i = 0; i < 5; i++) {
      const pairs = dictLemmaPairs(sources.dict, lib.items, { skipLocked: true })
      if (!pairs.length) break
      const next = dedupeLibrary(applyLemmaMap(lib, pairs))
      if (next === lib) break
      lib = next
      lemmaFixes += pairs.length
    }
  } else if (sources.lemmaPairs?.length) {
    const next = dedupeLibrary(applyLemmaMap(lib, sources.lemmaPairs))
    if (next !== lib) {
      lib = next
      lemmaFixes = sources.lemmaPairs.length
    }
  }

  // 1) 语言点收藏：按「每篇内容签名」只收一遍（删掉的条目不会自己回来）
  if (sources.langPoints.length) {
    const sig = langPointSignature(sources.langPoints)
    /**
     * 记账与实际不符时也重收：**词库里一条语言点都没有**，但文章里明明有
     * （换库、导库、早先版本丢过），说明那份「已收过」的记账是旧的 → 当成没收过。
     */
    const hasLangItems = lib.items.some((it) => (it.kind ?? 'word') !== 'word')
    const todo = Object.entries(sig).filter(([id, s]) => !hasLangItems || collected[id] !== s)
    if (todo.length) {
      const ids = new Set(todo.map(([id]) => id))
      const pts = sources.langPoints.filter((p) => ids.has(p.source.fileName ?? p.source.articleId))
      const next = upsertLanguagePoints(lib, pts, now)
      if (next !== lib) {
        lib = next
        langPoints = pts.length
      }
      collected = { ...collected, ...Object.fromEntries(todo) }
      collectedChanged = true
    }
  }

  // 2) 离线例句：只补「还差几条 / 卡片还有空位」的部分
  let offlineExamples = 0
  if (sources.offline) {
    const rows = collectOfflineExampleRows(lib.items, sources.offline.lookup)
    if (rows.length) {
      const next = applyExamples(lib, rows, now, 'tatoeba')
      if (next !== lib) {
        lib = next
        offlineExamples = rows.length
      }
    }
  }

  return {
    library: lib,
    collected,
    applied: { lemmaFixes, langPoints, offlineExamples },
    libraryUntouched: lib === library,
    collectedUntouched: !collectedChanged,
  }
}
