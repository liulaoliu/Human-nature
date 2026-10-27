import { useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * 阅读页的路由模型（**全站单入口**：BrowserRouter 在 `src/main.tsx`，这里只管 `/reader` 这一段）。
 *
 *   /reader                          阅读器（没有打开文章时显示文章列表）
 *   /reader/a/<slug>                 读某一篇
 *   /reader/a/<slug>/p/<panel>       读某一篇 + 打开某个面板
 *   /reader/a/<slug>/p/<panel>/<浮层> 读某一篇 + 面板 + 盖在它上面的浮层（如速读里的语言点）
 *   /reader/p/<panel>                没有文章时也能开的面板
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
  | 'browse-article'

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
  | 'back'
  | 'golden'
  | 'lang'
  | 'compose'

export type PanelName = BooleanPanelName | FlowName

export interface ReaderRoute {
  /** URL 里的文章 slug，空串 = 没打开文章 */
  slug: string
  /** 打开的面板 / 整页会话，空串 = 没有 */
  panel: PanelName | ''
  /**
   * 盖在 `panel` 之上的浮层会话（`/p/speed/lang` 里的 `lang`），空串 = 没有。
   *
   * 为什么要有这一格：语言点编辑器是居中弹层（`.lang-editor-overlay`），速读里点「语言点」
   * 时它盖在速读上面、底下的速读会话不能停。只用一个 `panel` 会把速读从 URL 里挤掉，
   * 结果一开语言点就掉回阅读主界面（2026-10-26 用户反馈）。
   */
  overlay: FlowName | ''
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
  'browse-article',
]

export const FLOW_NAMES: FlowName[] = [
  'study',
  'quiz',
  'quick',
  'dict',
  'listen',
  'write',
  'back',
  'golden',
  'lang',
  'compose',
]

const PANELS: PanelName[] = [...BOOLEAN_PANELS, ...FLOW_NAMES]

export function isFlowName(name: PanelName | ''): name is FlowName {
  return !!name && (FLOW_NAMES as string[]).includes(name)
}

/**
 * 能**叠在别的面板之上**的会话：目前只有语言点编辑。
 *
 * 判据是「它是不是居中的弹层」而不是「它是不是整页」：整页会话（背单词 / 考试 / 听力…）
 * 打开时会独占正文，底下的面板该关掉；语言点是 `.lang-editor-overlay` 弹层，
 * 底下的速读/计划要留着，关掉弹层就回到原来那一页。
 */
export const OVERLAY_FLOWS: FlowName[] = ['lang']

export function isOverlayFlow(name: PanelName | ''): name is FlowName {
  return !!name && (OVERLAY_FLOWS as string[]).includes(name)
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
    return { slug: '', ...parsePanels(parts.slice(1)) }
  }
  if (parts[0] !== 'a') return { slug: '', panel: '', overlay: '' }
  const slug = parts[1] ?? ''
  const panels = parts[2] === 'p' ? parsePanels(parts.slice(3)) : { panel: '' as const, overlay: '' as const }
  return { slug, ...panels }
}

/** `p/` 后面的段：`<panel>` 或 `<布尔面板>/<浮层>`。认不出的一律当没有，别把页面搞崩。 */
function parsePanels(parts: string[]): Pick<ReaderRoute, 'panel' | 'overlay'> {
  const base = parts[0] && (PANELS as string[]).includes(parts[0]) ? (parts[0] as PanelName) : ''
  if (!base) return { panel: '', overlay: '' }
  // 整页会话自己就占满正文，不往它上面再叠一层（地址里也不认这种写法）
  if (isFlowName(base)) return { panel: base, overlay: '' }
  const overlay = parts[1] && isOverlayFlow(parts[1] as PanelName) ? (parts[1] as FlowName) : ''
  return { panel: base, overlay }
}

export function articlePath(slug: string): string {
  return slug ? `${READER_BASE}/a/${slug}` : READER_BASE
}

/**
 * 面板路径。传了 `overlay` 就是「布尔面板 + 盖在它上面的浮层」：
 *   `panelPath('slug', 'speed', 'lang')` → `/reader/a/slug/p/speed/lang`
 *
 * 浮层只叠在布尔面板上：整页会话再叠会变成两个全屏界面抢同一个地址，
 * 所以 `panel` 本身是会话、或 `overlay` 不是浮层时，`overlay` 直接忽略。
 */
export function panelPath(slug: string, panel: PanelName, overlay: PanelName | '' = ''): string {
  // 没打开文章时面板也能开（计划 / 日志 / 统计 / 生词本 / 背单词）→ /reader/p/<panel>
  const base = slug ? `${READER_BASE}/a/${slug}/p/${panel}` : `${READER_BASE}/p/${panel}`
  return overlay && isOverlayFlow(overlay) && !isFlowName(panel) ? `${base}/${overlay}` : base
}

/** 面板名 → `useReaderPanels` 里那一对布尔值 / setter。 */
/** 当前路由所在的面板 → 该开哪个、该关哪些。 */
export function panelFlags(panel: PanelName | ''): Record<BooleanPanelName, boolean> {
  return {
    intensive: panel === 'intensive',
    speed: panel === 'speed',
    plan: panel === 'plan',
    journal: panel === 'journal',
    export: panel === 'export',
    goal: panel === 'goal',
    stats: panel === 'stats',
    browse: panel === 'browse',
    'browse-article': panel === 'browse-article',
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
  'browse-article': 'setBrowseArticle',
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

  // 状态 → 路由：包装后的 setter 只负责导航，真正的开关由上面那个 effect 完成。
  // 用 ref 读当前 slug / panel，setter 本身只依赖稳定的 navigate：否则每次路由或词库状态
  // 变化都会新建 8 个函数，下游 memo 全部失效（P2-4）。
  const slugRef = useRef(slug)
  slugRef.current = slug
  const panelRef = useRef(route.panel)
  panelRef.current = route.panel
  const setters = useMemo(() => {
    const out: Record<string, (v: boolean | ((prev: boolean) => boolean)) => void> = {}
    for (const name of Object.keys(PANEL_SETTER) as BooleanPanelName[]) {
      const key = PANEL_SETTER[name]
      out[key] = (v) => {
        // setStatsOpen((v) => !v) 这类函数式更新也要按「路由里现在开没开」求值，
        // 不能把整个函数当成 truthy 直接当 true（那样点一次就关不掉了）。
        const wasOpen = panelFlags(panelRef.current)[name]
        const next = typeof v === 'function' ? v(wasOpen) : v
        if (next === wasOpen) return
        // 打开：push 一层，返回键先回文章/列表；
        // 关闭：replace 掉当前面板层，返回键不再经过已经关掉的界面。
        if (next) navigate(panelPath(slugRef.current, name))
        else navigate(articlePath(slugRef.current), { replace: true })
      }
    }
    return out
  }, [navigate])
  return useMemo(() => ({ ...raw, ...setters }) as T, [raw, setters])
}
