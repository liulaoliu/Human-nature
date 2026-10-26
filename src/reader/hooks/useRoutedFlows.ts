import { useEffect, useReducer, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  articlePath,
  isFlowName,
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
  const prevRouteRef = useRef<PanelName | '' | null>(null)
  const prevActiveRef = useRef<FlowName | ''>('')
  const pendingRef = useRef<{ panel: FlowName; tried: boolean } | null>(null)
  /** 打开调用没有产生状态变化时，靠它再渲染一次来判「深链接失败」。 */
  const [, bump] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    if (!ready) return
    const latest = flowsRef.current
    const active = activeFlow(latest)
    const routePanel = route.panel
    const routeFlow: FlowName | '' = isFlowName(routePanel) ? routePanel : ''
    const first = prevRouteRef.current === null
    const routeChanged = first || prevRouteRef.current !== routePanel
    const activeChanged = prevActiveRef.current !== active

    prevRouteRef.current = routePanel

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
        navigate(panelPath(slugRef.current, active))
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
        navigate(panelPath(slugRef.current, active))
      } else if (!active && routeFlow) {
        // 用户在页面里点了「退出」→ 换掉这一层，别留一个已关掉的面板在历史里
        pendingRef.current = null
        navigate(articlePath(slugRef.current), { replace: true })
      }
    }

    prevActiveRef.current = active

    // 深链接打开了但没有状态（没词可背 / 没文章 / 没有可编辑的句子）→ 退回文章页
    const pending = pendingRef.current
    if (pending) {
      if (active === pending.panel) {
        pendingRef.current = null
      } else if (!pending.tried) {
        pending.tried = true
        bump()
      } else {
        pendingRef.current = null
        navigate(articlePath(slugRef.current), { replace: true })
      }
    }
  })
}
