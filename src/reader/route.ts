import { useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * 阅读页的路由模型（**全站单入口**：BrowserRouter 在 `src/main.tsx`，这里只管 `/reader` 这一段）。
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
 * 路径一律是**带 `/reader` 前缀的完整路径**（根 Router 没有 basename）；
 * `parseReaderRoute` 同时容忍不带前缀的老路径，方便单测/旧调用。
 */
export const READER_BASE = '/reader'

/** 「盖在正文上的一块界面」——布尔开关类的面板。 */
export type BooleanPanelName =
  | 'intensive'
  | 'speed'
  | 'plan'
  | 'journal'
  | 'export'
  | 'goal'
  | 'stats'
  | 'browse'
  | 'statsDetail'

/**
 * 整页会话 / 工具页：它们由业务 hook 的队列或开关驱动，不是一对 `useState`。
 *
 * 之所以也放进 `panel`：这些页面一打开就占满正文，用户按返回键应该回到
 * 「点它之前那一页」（文章 / 列表 / 另一个面板），而不是直接退出阅读器。
 */
export type FlowName =
  | 'study'
  | 'quiz'
  | 'quick'
  | 'dict'
  | 'listen'
  | 'write'
  | 'lang'
  | 'compose'

export type PanelName = BooleanPanelName | FlowName

export interface ReaderRoute {
  /** URL 里的文章 slug，空串 = 没打开文章 */
  slug: string
  /** 打开的面板 / 整页会话，空串 = 没有 */
  panel: PanelName | ''
}

const BOOLEAN_PANELS: BooleanPanelName[] = [
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

export const FLOW_NAMES: FlowName[] = [
  'study',
  'quiz',
  'quick',
  'dict',
  'listen',
  'write',
  'lang',
  'compose',
]

const PANELS: PanelName[] = [...BOOLEAN_PANELS, ...FLOW_NAMES]

export function isFlowName(name: PanelName | ''): name is FlowName {
  return !!name && (FLOW_NAMES as string[]).includes(name)
}

/** 去掉 `/reader` 前缀（`/reader` 本身与 `/reader/` 都归成 `/`）。 */
function stripReaderBase(pathname: string): string {
  if (pathname === READER_BASE || pathname === READER_BASE + '/') return '/'
  if (pathname.startsWith(READER_BASE + '/')) return pathname.slice(READER_BASE.length)
  return pathname
}

export function parseReaderRoute(pathname: string): ReaderRoute {
  const parts = stripReaderBase(pathname)
    .split('/')
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p)
      } catch {
        return p
      }
    })
  // /p/<panel>：没有文章时也能开的面板
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
  return slug ? `${READER_BASE}/a/${slug}` : READER_BASE
}

export function panelPath(slug: string, panel: PanelName): string {
  // 没打开文章时面板也能开（计划 / 日志 / 统计 / 生词本 / 背单词）→ /reader/p/<panel>
  return slug ? `${READER_BASE}/a/${slug}/p/${panel}` : `${READER_BASE}/p/${panel}`
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

/** 当前开着哪个布尔面板（一次只算一个：同时开两个时以先命中的为准，路由也只表达一个）。 */
export function openPanelName(p: PanelBooleans): BooleanPanelName | '' {
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
export function panelFlags(panel: PanelName | ''): Record<BooleanPanelName, boolean> {
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
const PANEL_SETTER: Record<BooleanPanelName, string> = {
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
 * 把「打开/关闭布尔面板」翻译成路由跳转，并把路由变化同步回面板状态。
 *
 * 调用方（工具栏、侧栏、学习动作）仍然写 `setIntensiveOpen(true)`，不用改：
 * 传进来的 setter 已经被包成「先导航、由路由回调再真正开」。
 *
 * 整页会话（背单词 / 考试 / …）不走这里，见 `hooks/useRoutedFlows`。
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
    for (const name of Object.keys(PANEL_SETTER) as BooleanPanelName[]) {
      const key = PANEL_SETTER[name]
      const set = (rawRef.current as Record<string, unknown>)[key] as ((v: boolean) => void) | undefined
      set?.(flags[name])
    }
  }, [route.panel])

  // 状态 → 路由：包装后的 setter 只负责导航，真正的开关由上面那个 effect 完成
  return useMemo(() => {
    const out = { ...raw } as Record<string, unknown>
    for (const name of Object.keys(PANEL_SETTER) as BooleanPanelName[]) {
      const key = PANEL_SETTER[name]
      ;(out as Record<string, (v: boolean) => void>)[key] = (v: boolean) => {
        if (v) navigate(panelPath(slug, name))
        else if (route.panel === name) navigate(articlePath(slug))
      }
    }
    return out as T
  }, [raw, navigate, slug, route.panel])
}
