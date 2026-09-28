import type { ScriptLookup, ScriptRepoPort } from '../core/ports'
import { findArticle, type ArticleBook } from '../core/matchArticle'

/**
 * 从 public/articles.json 读原文，按音频文件名查。
 *
 * 整个库一次取回来缓存住 —— 一共几百 KB，换文件不用重新下。
 *
 * **只缓存成功**。取失败（没起 dev server、路径不对、离线、服务重启的间隙）
 * 不缓存，下一次还试 —— 之前把失败也缓存住了，结果开发时重启一次服务器，
 * 已经打开的页面就再也拿不到原文，只能硬刷新，很难看出原因。
 */
export function createScriptRepo(url = 'articles.json'): ScriptRepoPort {
  let cached: ArticleBook | null = null
  let inflight: Promise<ArticleBook | null> | null = null
  let warned = false

  function load(): Promise<ArticleBook | null> {
    if (cached) return Promise.resolve(cached)
    if (!inflight) {
      inflight = fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`${url} 返回 HTTP ${r.status}`)
          return r.json() as Promise<ArticleBook>
        })
        .catch((e: unknown) => {
          if (!warned) {
            warned = true
            // 这一条在浏览器里出问题时最有用：能看到是路径不对、404、
            // 还是根本不是 http://localhost 打开的（file:// 下 fetch 会被拦）
            console.warn(
              `[原文库] 取不到 ${url}（${e instanceof Error ? e.message : String(e)}）。` +
              `原文对照会退回手动粘贴。确认地址栏是 http://localhost 开头的地址，` +
              `且 public/articles.json 存在。`,
            )
          }
          return null
        })
        .then((book) => {
          inflight = null
          if (book) {
            cached = book
            warned = false
          }
          return book
        })
    }
    return inflight
  }

  return {
    async find(fileName: string): Promise<ScriptLookup> {
      const book = await load()
      if (!book) return { text: null, library: false }
      return { text: findArticle(book, fileName)?.text ?? null, library: true }
    },
  }
}
