import { useEffect, useReducer, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  articlePath,
  isFlowName,
  isOverlayFlow,
  panelPath,
  type FlowName,
  type PanelName,
  type ReaderRoute,
} from '../route'

/** 一块整页会话/工具页的状态与开关。 */
export interface FlowControl {
  /** 现在是不是它盖在正文上。 */
  active: boolean
  /** 按 URL 打开它（深链接 / 前进后退）。失败就保持 inactive，调用方会被退回文章页。 */
  open: () => void
  /** 按 URL 关掉它（浏览器返回）。必须真的能关，别被「先确认」之类拦住。 */
  close: () => void
}

export type FlowControls = Record<FlowName, FlowControl>

/** 同时有多个（切换瞬间）：按「谁更占屏」取一个，和原来的 examActive/readingView 口径一致。 */
const PRIORITY: FlowName[] = ['study', 'quiz', 'quick', 'dict', 'listen', 'write', 'back', 'lang', 'compose']

function activeFlow(flows: FlowControls): FlowName | '' {
  for (const name of PRIORITY) {
    if (flows[name].active) return name
  }
  return ''
}

/**
 * 打开一个会话时该写哪个地址。
 *
 * 浮层会话（语言点）如果正盖在一个布尔面板上（速读 / 计划…），地址里要把底下那层留着
 * （`/p/speed/lang`），否则 `useRoutedPanels` 看到 `panel` 变成会话就会把速读关掉 ——
 * 用户反馈的「速读里点语言点，直接跳回阅读主界面」就是这个。
 */
function openPath(slug: string, panel: PanelName | '', flow: FlowName): string {
  if (isOverlayFlow(flow) && panel && !isFlowName(panel)) return panelPath(slug, panel, flow)
  return panelPath(slug, flow)
}

/** 关掉会话后回到哪：底下还压着布尔面板就回它，否则回文章 / 列表。 */
function underFlowPath(slug: string, panel: PanelName | ''): string {
  return panel && !isFlowName(panel) ? panelPath(slug, panel) : articlePath(slug)
}

/**
 * 整页会话/工具页 ↔ URL 的双向同步。
 *
 * 为什么需要它：背单词、考试、速读、听写、听力、仿写、全部生词、语言点编辑、
 * 新建文章这些界面一打开就占满正文。以前它们只是 `useState`，点开后地址栏不变，
 * 用户按返回键会直接退回跟读页/根页 —— 现场全丢。
 *
 * 规则（和 `useRoutedPanels` 同一套语义，只是这里的状态不是布尔对）：
 *
 *   1. **状态 → URL**：用户点按钮打开整页 → `push` 一层 `/reader/.../p/<panel>`；
 *   2. **URL → 状态**：浏览器前进/后退 → 打开/关闭对应会话；
 *   3. **深链接**：直接粘 `/reader/p/study` 也必须真的开；开不了（没词可背 / 没文章）
 *      就退回文章页，别让地址栏停在一个空界面上；
 *   4. 页面内点「退出」→ `replace` 掉当前层（返回键别再回到已经关掉的会话）。
 *   5. **浮层**（`OVERLAY_FLOWS`，目前只有语言点）叠在布尔面板上时，地址是
 *      `/p/<面板>/<浮层>`：打开保留底下那层，关闭 replace 回它；返回键只关浮层。
 *
 * effect 不写依赖数组：它同时看路由与状态两条线，靠 ref 记录上一帧。
 * 这是「一次渲染里把两个方向都判完」的写法，拆成两个 effect 会互相打架。
 */
export function useRoutedFlows(
  route: ReaderRoute,
  slug: string,
  flows: FlowControls,
  /** 数据还没就绪（词库 / 文章目录）时先不按 URL 开会话，等就绪那一帧再开。 */
  ready = true,
): void {
  const navigate = useNavigate()
  const flowsRef = useRef(flows)
  flowsRef.current = flows
  const slugRef = useRef(slug)
  slugRef.current = slug

  /** null = 还没跑过第一帧（首屏）；首帧不走「URL 没写就关掉」的逻辑。 */
  const prevRouteRef = useRef<string | null>(null)
  const prevActiveRef = useRef<FlowName | ''>('')
  const pendingRef = useRef<{ panel: FlowName; tried: boolean } | null>(null)
  /** 打开调用没有产生状态变化时，靠它再渲染一次来判「深链接失败」。 */
  const [, bump] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    if (!ready) return
    const latest = flowsRef.current
    const active = activeFlow(latest)
    const routePanel = route.panel
    // 地址里可能还写着「布尔面板 + 浮层」（`/p/speed/lang`）：浮层才是此刻打开的会话。
    const routeFlow: FlowName | '' = route.overlay || (isFlowName(routePanel) ? routePanel : '')
    const routeKey = route.overlay ? `${routePanel}/${route.overlay}` : routePanel
    const first = prevRouteRef.current === null
    const routeChanged = first || prevRouteRef.current !== routeKey
    const activeChanged = prevActiveRef.current !== active

    prevRouteRef.current = routeKey

    if (first) {
      prevActiveRef.current = active
      if (routeFlow) {
        // 深链接 / 刷新：URL 说了算
        if (active !== routeFlow) {
          if (active) latest[active].close()
          pendingRef.current = { panel: routeFlow, tried: false }
          latest[routeFlow].open()
          // open 没有产生状态变化（没词可背）时也要再渲染一次，才能判失败
          bump()
        }
      } else if (active) {
        // 刷新时从本机恢复出来的会话（考试队列之类）：把它写进 URL，别让它没有地址
        navigate(openPath(slugRef.current, routePanel, active))
      }
      return
    }

    if (routeChanged) {
      // 浏览器前进/后退 / 直接改地址：URL 是事实来源
      if (routeFlow) {
        if (active !== routeFlow) {
          if (active) latest[active].close()
          pendingRef.current = { panel: routeFlow, tried: false }
          latest[routeFlow].open()
          bump()
        } else {
          pendingRef.current = null
        }
      } else {
        pendingRef.current = null
        // 回到文章/列表：当前整页会话必须关掉
        if (active) latest[active].close()
      }
    } else if (activeChanged) {
      if (active && routeFlow !== active) {
        // 用户点了按钮 → 新增一层历史（返回键才能回到点之前那一页）
        pendingRef.current = null
        navigate(openPath(slugRef.current, routePanel, active))
      } else if (!active && routeFlow) {
        // 用户在页面里点了「退出」→ 换掉这一层，别留一个已关掉的面板在历史里。
        // 浮层下面还压着面板（速读里的语言点）就回到那一层，不是直接回文章。
        pendingRef.current = null
        navigate(underFlowPath(slugRef.current, routePanel), { replace: true })
      }
    }

    prevActiveRef.current = active

    // 深链接打开了但没有状态（没词可背 / 没文章 / 没有可编辑的句子）→ 退回底下那一层 / 文章页
    const pending = pendingRef.current
    if (pending) {
      if (active === pending.panel) {
        pendingRef.current = null
      } else if (!pending.tried) {
        pending.tried = true
        bump()
      } else {
        pendingRef.current = null
        navigate(underFlowPath(slugRef.current, routePanel), { replace: true })
      }
    }
  })
}
