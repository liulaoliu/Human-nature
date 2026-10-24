import type { SavedArticle } from '../types/document'
import { calendarDayKey } from './activity'

/** 参与「内容有没有变」判断的字段；标题 / 书名 / 来源也算改动。 */
export type ArticleContent = Pick<
  SavedArticle,
  'title' | 'book' | 'origin' | 'text' | 'paragraphs' | 'sentences'
>

/**
 * 文章内容指纹。
 *
 * 自动落盘靠它判断「这次 effect 是打开文章，还是用户真的改了东西」：
 * 只有指纹变了才写库，避免点一下列表就把 `updatedAt`（以及列表里的日期）顶掉。
 * JSON 的键顺序固定，数组顺序本身就是内容的一部分。
 */
export function articleFingerprint(a: ArticleContent): string {
  return JSON.stringify([a.title, a.book ?? '', a.origin ?? '', a.text, a.paragraphs, a.sentences])
}

export interface ArticleDateKeys {
  /** 建立日期 YYYY-MM-DD；老数据没有 createdAt 时用 updatedAt 兜底。 */
  created: string
  /** 最近修改日期 YYYY-MM-DD。 */
  updated: string
  /** 修改日与建立日不同（界面才需要显示「改」）。 */
  edited: boolean
}

function dayKey(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : calendarDayKey(d)
}

/**
 * 文章列表显示的日期口径：**建立日为主**，只有真的改过才附带修改日。
 * 无可用时间返回空串，由视图决定不渲染，避免出现 `NaN-NaN-NaN`。
 */
export function articleDateKeys(a: Pick<SavedArticle, 'createdAt' | 'updatedAt'>): ArticleDateKeys {
  const created = dayKey(a.createdAt) || dayKey(a.updatedAt)
  const updated = dayKey(a.updatedAt)
  return { created, updated, edited: !!updated && updated !== created }
}
