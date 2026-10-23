import { useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * 阅读页的路由模型（react-router 的 HashRouter）。
 *
 *   #/                     阅读器（没有打开文章时显示文章列表）
 *   #/a/<ref>              读某一篇
 *   #/a/<ref>/p/<panel>    读某一篇 + 打开某个面板
 *
 * `ref` 就是原来的文章标识：`b:<内置 key>` 或 `s:<已保存 id>`。
 *
 * **为什么用 Hash 而不是路径**：`reader.html` 是静态页面，路径路由要求服务端把
 * 未知路径回落到它（dev 的 Vite、生产的 httpApp 都要加 rewrite；漏配就 404）。
 * hash 不需要任何服务端配置，刷新/收藏也都能还原现场。
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
  /** `b:key` / `s:id` / 空串（没打开文章） */
  ref: string
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
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent)
  // #/p/<panel>：没有文章时也能开的面板
  if (parts[0] === 'p') {
    const only = parts[1] && (PANELS as string[]).includes(parts[1]) ? (parts[1] as PanelName) : ''
    return { ref: '', panel: only }
  }
  if (parts[0] !== 'a') return { ref: '', panel: '' }
  const ref = parts[1] ?? ''
  const panel = parts[2] === 'p' && parts[3] && (PANELS as string[]).includes(parts[3]) ? (parts[3] as PanelName) : ''
  return { ref, panel }
}

export function articlePath(ref: string): string {
  return ref ? `/a/${encodeURIComponent(ref)}` : '/'
}

export function panelPath(ref: string, panel: PanelName): string {
  // 没打开文章时面板也能开（计划 / 日志 / 统计 / 生词本）→ #/p/<panel>
  return ref ? `/a/${encodeURIComponent(ref)}/p/${panel}` : `/p/${panel}`
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
  ref: string,
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
        if (v) navigate(panelPath(ref, name))
        else if (route.panel === name) navigate(articlePath(ref))
      }
    }
    return out as T
  }, [raw, navigate, ref, route.panel])
}
