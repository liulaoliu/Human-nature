import { parseEcdict, type Ecdict } from '../core/ecdict'

/**
 * 离线词典的加载与缓存（数据：tools/build-ecdict.mjs 产出的 public/ecdict*.tsv）。
 * 没有数据文件时静默失败——所有用到词典的功能自动降级。
 */
let dict: Ecdict | null = null
let loading: Promise<boolean> | null = null

export function dictionary(): Ecdict | null {
  return dict
}
export function dictionaryReady(): boolean {
  return !!dict
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
      const [w, f] = await Promise.all([
        fetch(`${base}/ecdict.tsv`).then((r) => (r.ok ? r.text() : '')),
        fetch(`${base}/ecdict-forms.tsv`).then((r) => (r.ok ? r.text() : '')),
      ])
      if (!w) return false
      dict = parseEcdict(w, f)
      return true
    } catch {
      return false
    } finally {
      loading = null
    }
  })()
  return loading
}
