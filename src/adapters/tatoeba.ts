import { examplesFor, parseTatoeba, type ExampleSentence, type Tatoeba } from '../core/tatoeba'

/**
 * 离线例句的加载与缓存（数据：tools/build-tatoeba.mjs → public/tatoeba-en.tsv）。
 * 没有数据文件时静默失败——「离线例句」按钮会自动提示去构建。
 */
let tatoeba: Tatoeba | null = null
let loading: Promise<boolean> | null = null

export function tatoebaReady(): boolean {
  return !!tatoeba
}

/** 按词形 / 原形查例句；没加载或查不到返回 []。 */
export function tatoebaExamples(word: string, lemma?: string): ExampleSentence[] {
  return tatoeba ? examplesFor(tatoeba, word, lemma) : []
}

/** 测试用：注入数据。 */
export function setTatoeba(t: Tatoeba | null): void {
  tatoeba = t
}

export async function loadTatoeba(base = ''): Promise<boolean> {
  if (tatoeba) return true
  if (loading) return loading
  loading = (async () => {
    try {
      const r = await fetch(`${base}/tatoeba-en.tsv`)
      if (!r.ok) return false
      const text = await r.text()
      if (!text.trim()) return false
      tatoeba = parseTatoeba(text)
      return true
    } catch {
      return false
    } finally {
      loading = null
    }
  })()
  return loading
}
