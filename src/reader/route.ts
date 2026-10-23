import { useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * 阅读页的路由模型（react-router 的 BrowserRouter，basename = `/reader`）。
 *
 *   /reader                    阅读器（没有打开文章时显示文章列表）
 *   /reader/a/<slug>           读某一篇
 *   /reader/a/<slug>/p/<panel> 读某一篇 + 打开某个面板
 *   /reader/p/<panel>          没有文章时也能开的面板
 *
 * **`slug` 不是内部标识**：`b:005 Leaders` 那种东西不会出现在地址栏里。
 * slug 由标题算（`005-leaders-post-truth-politics`），映射表在 `core/articleIndex`。
 * 这里只当字符串用，不管它怎么来的。
 *
 * 构造的都是**不含 basename** 的路径（`/a/xxx`），BrowserRouter 会自动补
 * `/reader` 前缀，`useLocation()` 拿回来的也是去掉前缀的。
 *
 * 服务端要把 `/reader**` 回落到 `reader.html`：dev 由 `vite.config.ts` 的
 * `readerRoutePlugin` 做，生产由 `server/httpApp.js` 的 `isReaderPath` 做。
 * 漏一处就是刷新 404 / 白屏。
 */

export type PanelName =
  | 'intensive'
  | 'speed'
  | 'plan'
  | 'journal'
  | 'export'
  | 'goal'
  | 'stats'
  | 'browse'
  | 'statsDetail'

export interface ReaderRoute {
  /** URL 里的文章 slug，空串 = 没打开文章 */
  slug: string
  /** 打开的面板，空串 = 没有 */
  panel: PanelName | ''
}

const PANELS: PanelName[] = [
  'intensive',
  'speed',
  'plan',
  'journal',
  'export',
  'goal',
  'stats',
  'browse',
  'statsDetail',
]

export function parseReaderRoute(pathname: string): ReaderRoute {
  const parts = pathname
    .split('/')
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p)
      } catch {
        return p
      }
    })
  // #/p/<panel>：没有文章时也能开的面板
  if (parts[0] === 'p') {
    const only = parts[1] && (PANELS as string[]).includes(parts[1]) ? (parts[1] as PanelName) : ''
    return { slug: '', panel: only }
  }
  if (parts[0] !== 'a') return { slug: '', panel: '' }
  const slug = parts[1] ?? ''
  const panel = parts[2] === 'p' && parts[3] && (PANELS as string[]).includes(parts[3]) ? (parts[3] as PanelName) : ''
  return { slug, panel }
}

export function articlePath(slug: string): string {
  return slug ? `/a/${slug}` : '/'
}

export function panelPath(slug: string, panel: PanelName): string {
  // 没打开文章时面板也能开（计划 / 日志 / 统计 / 生词本）→ /p/<panel>
  return slug ? `/a/${slug}/p/${panel}` : `/p/${panel}`
}

/** 面板名 → `useReaderPanels` 里那一对布尔值 / setter。 */
export interface PanelBooleans {
  intensiveOpen: boolean
  speedReadOpen: boolean
  planOpen: boolean
  journalOpen: boolean
  exportOpen: boolean
  goalOpen: boolean
  statsOpen: boolean
  browseAll: boolean
}

/** 当前开着哪个面板（一次只算一个：同时开两个时以先命中的为准，路由也只表达一个）。 */
export function openPanelName(p: PanelBooleans): PanelName | '' {
  if (p.intensiveOpen) return 'intensive'
  if (p.speedReadOpen) return 'speed'
  if (p.planOpen) return 'plan'
  if (p.journalOpen) return 'journal'
  if (p.exportOpen) return 'export'
  if (p.goalOpen) return 'goal'
  if (p.statsOpen) return 'stats'
  if (p.browseAll) return 'browse'
  return ''
}

/** 当前路由所在的面板 → 该开哪个、该关哪些。 */
export function panelFlags(panel: PanelName | ''): Record<PanelName, boolean> {
  return {
    intensive: panel === 'intensive',
    speed: panel === 'speed',
    plan: panel === 'plan',
    journal: panel === 'journal',
    export: panel === 'export',
    goal: panel === 'goal',
    stats: panel === 'stats' || panel === 'statsDetail',
    browse: panel === 'browse',
    statsDetail: panel === 'statsDetail',
  }
}

/** 面板名 → 它在 `useReaderPanels` 里的 setter 名（写死一张表，别用字符串拼）。 */
const PANEL_SETTER: Record<PanelName, string> = {
  intensive: 'setIntensiveOpen',
  speed: 'setSpeedReadOpen',
  plan: 'setPlanOpen',
  journal: 'setJournalOpen',
  export: 'setExportOpen',
  goal: 'setGoalOpen',
  stats: 'setStatsOpen',
  browse: 'setBrowseAll',
  statsDetail: 'setStatsOpen',
}

/**
 * 把「打开/关闭面板」翻译成路由跳转，并把路由变化同步回面板状态。
 *
 * 调用方（工具栏、侧栏、学习动作）仍然写 `setIntensiveOpen(true)`，不用改：
 * 传进来的 setter 已经被包成「先导航、由路由回调再真正开」。
 */
export function useRoutedPanels<T extends object>(
  raw: T,
  route: ReaderRoute,
  slug: string,
): T {
  const navigate = useNavigate()
  const rawRef = useRef(raw)
  rawRef.current = raw

  // 路由 → 状态：URL 里写了哪个面板就开哪个，其余关掉。
  // setter 是 useState 给的稳定引用，所以只依赖 route.panel 就够。
  useEffect(() => {
    const flags = panelFlags(route.panel)
    for (const name of Object.keys(PANEL_SETTER) as PanelName[]) {
      const key = PANEL_SETTER[name]
      const set = (rawRef.current as Record<string, unknown>)[key] as ((v: boolean) => void) | undefined
      set?.(flags[name])
    }
  }, [route.panel])

  // 状态 → 路由：包装后的 setter 只负责导航，真正的开关由上面那个 effect 完成
  return useMemo(() => {
    const out = { ...raw } as Record<string, unknown>
    for (const name of Object.keys(PANEL_SETTER) as PanelName[]) {
      const key = PANEL_SETTER[name]
      ;(out as Record<string, (v: boolean) => void>)[key] = (v: boolean) => {
        if (v) navigate(panelPath(slug, name))
        else if (route.panel === name) navigate(articlePath(slug))
      }
    }
    return out as T
  }, [raw, navigate, slug, route.panel])
}
