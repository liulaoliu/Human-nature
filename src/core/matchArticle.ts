/**
 * 按音频文件名找配套原文。
 *
 * articles.json 的键是 mp3 的文件名（不含扩展名），比如
 *   「009 Leaders - Interest-rate caps」
 * 用户手上的文件可能改过名、撇号变成下划线、大小写不一致，所以分三档找：
 *   1. 去扩展名后完全一致
 *   2. 归一化后一致（下划线/撇号、大小写、多余空白都抹平）
 *   3. 开头的期号一致（「009 …」）—— 前缀是这套音频的固定编号，最稳
 * 找不到就返回 null，让用户手动粘。
 */

/** 一条原文。只用到 text，title/words 留着以后显示用。 */
export interface Article {
  title: string
  words: number
  text: string
}

export type ArticleBook = Record<string, Article>

/** 去掉路径和扩展名，只留文件名主体 */
export function baseName(fileName: string): string {
  const name = fileName.split(/[\\/]/).pop() ?? fileName
  return name.replace(/\.[A-Za-z0-9]{1,5}$/, '')
}

/**
 * 归一化：把文件系统里各种「差不多」的写法抹成同一个串。
 * 撇号在 mp3 名里是下划线（Rodrigo Duterte），在别处可能是 ' 或 ’。
 */
export function normalize(s: string): string {
  return s
    .replace(/[’'`]/g, '_')
    .replace(/_+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * 抹掉文件名尾巴上的 32 位哈希。
 * 2021 那代叫「005-Leaders---The-green-boom-<32位哈希>.mp3」，
 * 同一篇重新下载哈希可能不一样，比对前先去掉，不然归一化那一档全废。
 */
export function stripHash(s: string): string {
  return s.replace(/-[0-9a-f]{32}$/i, '')
}

/**
 * 文件名的代次风格。两期的写法不一样，而且能靠它把两期隔开：
 *   spaced  2016「009 Leaders - Interest-rate caps」
 *   dashed  2021「005-Leaders---The-green-boom-<哈希>」
 *   other   认不出来
 *
 * 为什么非要隔开：两期的期号是各自编的，2016 有 023，2021 也有 023，
 * 但指的是完全不同的两篇。库是两期混装的，只按期号兜底就会把
 * 「023 The Americas - Bello」配到 2021 的 023 上去 —— 播着 2016 的音频，
 * 显示 2021 的文本，比没有文本更糟。
 */
export function styleOf(s: string): 'spaced' | 'dashed' | 'other' {
  if (/^\d{3}-.+---/.test(s)) return 'dashed'
  if (/^\d{3} .+ - /.test(s)) return 'spaced'
  return 'other'
}

/**
 * 在库里找一篇。两档，全不中返回 null。
 *  1. 去扩展名后完全一致（用户手上的文件就是下载来的那个名字，一般走这档）
 *  2. 归一化后一致：抹掉尾巴上的哈希、撇号统一、忽略大小写和空白
 *     （同一篇重新下载、哈希变了就走这档）
 *
 * 以前还有第三档「按期号兜底」，删掉了：库是两期混装的，两期各自编期号，
 * 2016 有 023、2021 也有 023，指的是两篇不同的文章；就算只装一期，
 * 「023 随便什么标题」也会被配到库里那个 023 上 —— 播着这期的音频、
 * 显示那篇文章，比没有文本更糟。找不到就让用户手动粘。
 * 归一化那一档也只在**同一代次**的文件名写法里比对，理由同上。
 */
export function findArticle(book: ArticleBook, fileName: string): Article | null {
  const base = baseName(fileName)
  const exact = book[base]
  if (exact) return exact

  const style = styleOf(base)
  const target = normalize(stripHash(base))
  for (const [key, value] of Object.entries(book)) {
    if (styleOf(key) !== style) continue
    if (normalize(stripHash(key)) === target) return value
  }
  return null
}
