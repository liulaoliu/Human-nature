import { parseEcdict, type Ecdict } from '../core/ecdict'
import { mwldLookup, parseMwld, type Mwld, type MwldEntry } from '../core/mwld'

/**
 * 离线词典的加载与缓存（数据：tools/build-ecdict.mjs / build-mwld.mjs 产出）。
 * 没有数据文件时静默失败——所有用到词典的功能自动降级。
 */
let dict: Ecdict | null = null
let mwld: Mwld | null = null
let loading: Promise<boolean> | null = null

export function dictionary(): Ecdict | null {
  return dict
}
export function dictionaryReady(): boolean {
  return !!dict
}
/** M-W 学习者词典（更准确的 IPA 与英文释义）。 */
export function mwldDict(): Mwld | null {
  return mwld
}
/** 查 M-W（用 ECDICT 词形表先还原原形）。 */
export function mwldLookupWord(word: string): MwldEntry | null {
  return mwld ? mwldLookup(mwld, word, dict?.forms) : null
}
/** 测试用：注入词典。 */
export function setDictionary(d: Ecdict | null): void {
  dict = d
}

export async function loadDictionary(base = ''): Promise<boolean> {
  if (dict) return true
  if (loading) return loading
  loading = (async () => {
    try {
      const [w, f, n, m] = await Promise.all([
        fetch(`${base}/ecdict.tsv`).then((r) => (r.ok ? r.text() : '')),
        fetch(`${base}/ecdict-forms.tsv`).then((r) => (r.ok ? r.text() : '')),
        fetch(`${base}/ecdict-near.tsv`).then((r) => (r.ok ? r.text() : '')),
        fetch(`${base}/mwld.tsv`).then((r) => (r.ok ? r.text() : '')),
      ])
      if (!w) return false
      dict = parseEcdict(w, f, n)
      mwld = m ? parseMwld(m) : null
      return true
    } catch {
      return false
    } finally {
      loading = null
    }
  })()
  return loading
}
