/**
 * 正文签名：只由句子文本算（djb2），用来给「这篇文章」一个内容级标识。
 *
 * 为什么不用文章的 `articleIdentity`：那玩意儿可能是书名、空标题或「未命名」，
 * 两篇完全不同的正文完全可能共用一个标识。凡是「按文章记住点什么」的地方
 * （速读游标、阅读页滚动位置），键里都得带上这个签名，才不会被另一篇同标识的文章串掉。
 *
 * 顺带的好处：正文改过签名就变，旧进度自然作废（改过正文再按老位置续读本来就没意义）。
 */
export function docSignature(sentences: ReadonlyArray<{ text: string }>): string {
  let h = 5381
  for (const s of sentences) {
    const t = s.text
    for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0
    h = ((h << 5) + h + 10) | 0 // 句间分隔，避免「ab|c」与「a|bc」撞签名
  }
  return (h >>> 0).toString(36)
}

/**
 * 文章键：本机「按文章存」的键统一用它，格式 `标识@正文签名`。
 *
 * 只带标识会串篇（空标题 / 同名 / 「未命名」），只带签名会在正文相同的两篇文章间串。
 * 滚动进度、速读游标/本页清单、听写游标、听力题缓存都走这里，别再各拼各的。
 */
export function articleKey(identity: string, sentences: ReadonlyArray<{ text: string }>): string {
  return `${identity}@${docSignature(sentences)}`
}
