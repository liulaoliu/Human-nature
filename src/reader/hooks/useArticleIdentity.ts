import { useRef } from 'react'
import { docSignature } from '../../core/docSignature'

/**
 * 当前文章的「词库 / 学习记录归属键」。
 *
 * 为什么需要它：`articleKey || savedId || articleTitle || '手动粘贴'` 这条链在
 * **删掉保存**的瞬间会从 `saved:<id>` 掉回标题。同一篇正文、同一个读者，身份却换了，
 * 于是自动收录（`useLibraryAutoFill`）会把这篇的语言点按标题再收一遍 —— 词库里出现两套键，
 * 旧的成了指向不存在文章的孤儿（2026-10-29 真实踩过：Profits overboard 重复篇）。
 *
 * 规矩：**正文没换，身份就不换。** 记住「正文签名 → 上次的身份」，签名一致时沿用它；
 * 正文换了（新粘贴 / 改写过）才允许回退到标题。
 */
export interface UseArticleIdentityParams {
  /** 内置文章（书里的原文）的键 */
  articleKey: string | null
  /** 已保存文章的 id；删掉保存后变 null */
  savedId: string | null
  articleTitle: string
  /** 当前正文的句子（只用来算签名，不参与归属） */
  sentences: ReadonlyArray<{ text: string }> | null | undefined
}

export interface ArticleIdentity {
  /** 生词 / 学习记录归属这篇文章的键 */
  identity: string
  /**
   * 「删掉保存后又想存回去」时复用的 id（同一篇正文）。
   * 没有可复用的就是 null，保存时按老规则新建。
   */
  reuseId: string | null
}

export function useArticleIdentity({
  articleKey,
  savedId,
  articleTitle,
  sentences,
}: UseArticleIdentityParams): ArticleIdentity {
  const sig = sentences?.length ? docSignature(sentences) : ''
  const explicit = articleKey || savedId || ''
  const remembered = useRef<{ sig: string; id: string } | null>(null)

  // 渲染期写 ref：必须同步生效（晚一帧就可能先按标题收一轮语言点）。
  // 只在「已保存 + 正文签名」齐备时记，且同值不重写，StrictMode 双调用也幂等。
  if (savedId && sig) {
    const prev = remembered.current
    if (!prev || prev.id !== savedId || prev.sig !== sig) remembered.current = { sig, id: savedId }
  }

  const held = remembered.current
  const reuseId = !explicit && held && sig && held.sig === sig ? held.id : null
  return { identity: explicit || reuseId || articleTitle || '手动粘贴', reuseId }
}
