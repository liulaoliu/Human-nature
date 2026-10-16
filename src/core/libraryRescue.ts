/**
 * 词库**救援**：从本机其它记录里把词条捞回来。
 *
 * 场景：词库被误清 / 读失败事故后，词没了，但本机还留着这些痕迹：
 *   - `reader:batch`：各篇文章的「待选词」清单（词 + 所在句，最有价值）
 *   - `reader:mistakes`：错题本（词条 id 形如 `vocab:run`，还有显示标签）
 * 用它们重新建词条（词形 + 来源句；释义可以之后用离线词典/AI 补，本地 `补齐生词本` 即可）。
 *
 * 纯函数：给同样的记录总是同样的结果，调用方只管读记录、写词库。
 */
import type { VocabLibrary } from '../types/document'
import { markWord } from './vocab'

/** 从本机读出来的救援素材。 */
export interface RescueRecords {
  /** 待选清单：文章标识 → 条目（词 + 所在句） */
  batch?: Record<string, { word: string; sentence?: string; sentenceId?: string | null }[]>
  /** 错题本里出现的词（显示标签） */
  mistakeWords?: string[]
}

export interface RescueResult {
  library: VocabLibrary
  /** 这次补回来多少条（已存在的算「找到但没新加」） */
  added: number
  /** 素材里一共认出多少个不同的词 */
  found: number
}

/** 从 `vocab:xxx` 这种 id 里抠出 lemma（错题本只有 id 时用）。 */
function lemmaFromItemId(id: string): string {
  return id.startsWith('vocab:') ? id.slice('vocab:'.length) : ''
}

/** 把救援素材里的词条并回词库（幂等：已有的不重复建）。 */
export function rescueLibrary(library: VocabLibrary, records: RescueRecords, now: Date = new Date()): RescueResult {
  const seen = new Set<string>()
  const entries: { word: string; sentence?: string; sentenceId?: string | null; articleId: string }[] = []

  for (const [articleId, list] of Object.entries(records.batch ?? {})) {
    for (const b of list ?? []) {
      const word = (b.word ?? '').trim()
      if (!word) continue
      const key = word.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      entries.push({ word, sentence: b.sentence, sentenceId: b.sentenceId ?? null, articleId })
    }
  }
  for (const raw of records.mistakeWords ?? []) {
    const lemma = lemmaFromIdOrWord(raw)
    if (!lemma) continue
    const key = lemma.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    entries.push({ word: lemma, articleId: '（恢复自错题本）' })
  }

  let lib = library
  let added = 0
  for (const e of entries) {
    try {
      const r = markWord(
        lib,
        {
          word: e.word,
          articleId: e.articleId,
          fileName: e.articleId.startsWith('（') ? null : e.articleId,
          sentenceId: e.sentenceId ?? null,
          sentenceText: e.sentence ?? '',
        },
        now,
      )
      // 已经有了就不动它（幂等；也保住调用方「没变化就别写库」的判断）
      if (!r.created) continue
      lib = r.library
      added++
    } catch {      // 词形归一后为空之类的脏数据：跳过
    }
  }
  return { library: lib, added, found: entries.length }
}

/** 错题本条目可能是 `vocab:run` 或直接是词。 */
function lemmaFromIdOrWord(raw: string): string {
  const s = (raw ?? '').trim()
  if (!s) return ''
  const fromId = lemmaFromItemId(s)
  return fromId || s
}
