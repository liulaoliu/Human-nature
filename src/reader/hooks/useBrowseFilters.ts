import { useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { BrowseScope } from '../../core/vocabBrowse'
import { browseFilterSearch, parseBrowseFilters, type BrowseFilterState } from '../browseQuery'

export interface BrowseFiltersHandle {
  filters: BrowseFilterState
  setFilters: (next: BrowseFilterState) => void
}

/**
 * 生词浏览页筛选 ↔ URL query 的接线。
 *
 * - URL 是事实来源：刷新 / 分享地址回到同一组筛选；
 * - 只改 query、不改 pathname，避免把面板开关从地址里挤掉；
 * - 用 replace（筛选不是「打开新页面」，不能污染返回键）；
 * - 序列化后和当前 query 相同就不导航（输入法/重复点不会堆 history）。
 *
 * `fallbackScope` = 入口面板的默认范围（`browse` → all，`browse-article` → article）：
 * 它让「从本篇入口打开时 scope=article」不必写进地址，地址更短。
 */
export function useBrowseFilters(fallbackScope: Exclude<BrowseScope, 'picked'>): BrowseFiltersHandle {
  const location = useLocation()
  const navigate = useNavigate()
  const filters = useMemo(
    () => parseBrowseFilters(location.search, fallbackScope),
    [location.search, fallbackScope],
  )

  const setFilters = useCallback(
    (next: BrowseFilterState) => {
      const search = browseFilterSearch(next, fallbackScope)
      const current = location.search.startsWith('?') ? location.search.slice(1) : location.search
      if (search === current) return
      navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true })
    },
    [navigate, location.pathname, location.search, fallbackScope],
  )

  return { filters, setFilters }
}
