/**
 * 生词浏览页的筛选状态 ↔ URL query（纯函数）。
 *
 * 为什么放 URL：这是整页面板，刷新 / 把地址发给别人应该回到同一组筛选；
 * 用 **query** 而不是再开一个 panel 名：筛选是页面内状态，路径只决定「从哪个入口进来」。
 *
 * 约定：
 *   - 默认值不写进 URL（全部 / 全部状态 / 空的搜索 / 没选日期），保持地址短；
 *   - 日期写成 `days=YYYY-MM-DD,YYYY-MM-DD`；解析时排序去重；
 *   - 选篇用重复参数 `picked=<id>`；`picked=all` 或没有该参数 = 全选，`picked=` = 一个都不选；
 *   - `scope` 只在和入口默认值不同时写，例如从 `/p/browse-article` 切到全部才写 `scope=all`；
 *   - `mastered` 只在和该范围的默认值不同时写（全部默认含已掌握，本篇 / 选篇默认不含）。
 */
import type { BrowseKind, BrowseScope, BrowseStatus } from '../core/vocabBrowse'

export interface BrowseFilterState {
  scope: BrowseScope
  kind: BrowseKind
  query: string
  /** 入库日（YYYY-MM-DD），空数组 = 全部日期 */
  days: string[]
  status: BrowseStatus
  includeMastered: boolean
  /** 选篇文章 id；`undefined` = 默认全选，`[]` = 一个都不选 */
  picked?: string[]
}

const SCOPES: BrowseScope[] = ['all', 'article', 'picked']
const KINDS: BrowseKind[] = ['all', 'word', 'lang']
const STATUSES: BrowseStatus[] = ['all', 'due', 'fresh', 'lapsed', 'mastered']
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

function oneOf<T extends string>(v: string | null, list: readonly T[], fallback: T): T {
  return v && (list as readonly string[]).includes(v) ? (v as T) : fallback
}

/** 该范围的「含已掌握」默认值：全部默认看，本篇 / 选篇默认不看。 */
export function defaultIncludeMastered(scope: BrowseScope): boolean {
  return scope === 'all'
}

export function defaultBrowseFilters(scope: BrowseScope = 'all'): BrowseFilterState {
  return {
    scope,
    kind: 'all',
    query: '',
    days: [],
    status: 'all',
    includeMastered: defaultIncludeMastered(scope),
    picked: undefined,
  }
}

export function parseBrowseFilters(search: string, fallbackScope: BrowseScope = 'all'): BrowseFilterState {
  const q = new URLSearchParams(search)
  const scope = oneOf(q.get('scope'), SCOPES, fallbackScope)
  const kind = oneOf(q.get('kind'), KINDS, 'all')
  const status = oneOf(q.get('status'), STATUSES, 'all')
  const days = [...new Set((q.get('days') ?? '').split(',').filter((d) => DAY_KEY.test(d)))].sort()
  const query = q.get('q') ?? ''
  const masteredRaw = q.get('mastered')
  const includeMastered = masteredRaw === null ? defaultIncludeMastered(scope) : masteredRaw === '1'

  let picked: string[] | undefined
  if (scope === 'picked') {
    const raw = q.getAll('picked')
    if (!raw.length || (raw.length === 1 && raw[0] === 'all')) picked = undefined
    else if (raw.length === 1 && raw[0] === '') picked = []
    else picked = raw.filter(Boolean)
  }

  return { scope, kind, query, days, status, includeMastered, picked }
}

/**
 * 筛选状态 → query 字符串（不含 `?`）。
 * `fallbackScope` = 当前入口路径（`browse` / `browse-article`）的默认范围，相等时不写 scope。
 */
export function browseFilterSearch(f: BrowseFilterState, fallbackScope: BrowseScope = 'all'): string {
  const q = new URLSearchParams()
  if (f.scope !== fallbackScope) q.set('scope', f.scope)
  if (f.kind !== 'all') q.set('kind', f.kind)
  if (f.query) q.set('q', f.query)
  if (f.days.length) q.set('days', [...new Set(f.days)].sort().join(','))
  if (f.status !== 'all') q.set('status', f.status)
  if (f.includeMastered !== defaultIncludeMastered(f.scope)) {
    q.set('mastered', f.includeMastered ? '1' : '0')
  }
  if (f.scope === 'picked') {
    if (f.picked === undefined) {
      // 默认全选：不写，刷新后仍按本机已保存文章全选
    } else if (f.picked.length === 0) {
      q.set('picked', '')
    } else {
      for (const id of [...f.picked].sort()) q.append('picked', id)
    }
  }
  return q.toString()
}
