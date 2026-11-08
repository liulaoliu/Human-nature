// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import type { ReactNode } from 'react'
import { FLOW_NAMES, parseReaderRoute } from '../route'
import { useRoutedFlows, type FlowControls } from './useRoutedFlows'

/**
 * 整页会话 ↔ URL。
 *
 * 重点不是「打开函数被调了没有」，而是**历史层数**：
 *   · 点按钮打开 → 地址栏多一层；
 *   · 浏览器返回 → 关掉会话，但不额外再导航；
 *   · 页面里点退出 → 用 replace 抹掉这一层，返回键别再回到已关掉的页面。
 */

const idle = (): FlowControls =>
  Object.fromEntries(
    FLOW_NAMES.map((name) => [name, { active: false, open: vi.fn(), close: vi.fn() }]),
  ) as unknown as FlowControls

function setup(initialPath: string, initialFlows: FlowControls, initialReady = true) {
  let seen = initialPath
  let navigate: ReturnType<typeof useNavigate> | null = null
  let flows = initialFlows
  let ready = initialReady
  let navType = 'POP' as ReturnType<typeof useNavigationType>

  function Probe() {
    const loc = useLocation()
    seen = loc.pathname + loc.search
    navType = useNavigationType()
    return null
  }
  function NavCapture() {
    navigate = useNavigate()
    return null
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialPath]}>
      <Probe />
      <NavCapture />
      {children}
    </MemoryRouter>
  )

  const hook = renderHook(() => {
    const loc = useLocation()
    const route = parseReaderRoute(loc.pathname, loc.search)
    useRoutedFlows(route, route.slug, flows, ready)
  }, { wrapper })

  return {
    ...hook,
    path: () => seen,
    navType: () => navType,
    go: (to: string) => act(() => navigate?.(to)),
    update: (next: FlowControls, nextReady = ready) => {
      flows = next
      ready = nextReady
      hook.rerender()
    },
  }
}

describe('useRoutedFlows：状态 → URL', () => {
  it('点「背单词」打开整页 → push 一层 /reader/p/study', async () => {
    const flows = idle()
    const h = setup('/', flows)

    flows.study.active = true
    h.update(flows)

    await waitFor(() => expect(h.path()).toBe('/reader/p/study'))
  })

  it('有文章时把 slug 一起带进 URL', async () => {
    const flows = idle()
    const h = setup('/reader/a/my-article', flows)

    flows.quiz.active = true
    h.update(flows)

    await waitFor(() => expect(h.path()).toBe('/reader/a/my-article/p/quiz'))
  })

  it('页面内点退出 → replace 回文章页（不新增一层）', async () => {
    const flows = idle()
    flows.dict.active = true
    const h = setup('/reader/a/my-article/p/dict', flows)

    flows.dict.active = false
    h.update(flows)

    await waitFor(() => expect(h.path()).toBe('/reader/a/my-article'))
  })
})

describe('useRoutedFlows：两个整页会话直接切换', () => {
  it('考试挂起去背单词 → replace 掉考试那一层，不在历史里留旧会话', async () => {
    const flows = idle()
    flows.quiz.active = true
    const h = setup('/reader/a/my-article/p/quiz?back=intensive', flows)

    flows.study.active = true // 考试仍挂着（队列没清），背单词盖上来
    h.update(flows)

    await waitFor(() => expect(h.path()).toBe('/reader/a/my-article/p/study?back=intensive'))
    expect(h.navType()).toBe('REPLACE')
  })

  it('学完回到挂起的考试 → 也是 replace，返回键不会把背单词再开一轮', async () => {
    const flows = idle()
    flows.study.active = true
    const h = setup('/reader/a/my-article/p/study?back=intensive', flows)

    flows.quiz.active = true
    flows.study.active = false
    h.update(flows)

    await waitFor(() => expect(h.path()).toBe('/reader/a/my-article/p/quiz?back=intensive'))
    expect(h.navType()).toBe('REPLACE')
  })
})

describe('useRoutedFlows：URL → 状态（返回键）', () => {
  it('浏览器返回到文章页 → 关掉会话，不再额外导航', async () => {
    const flows = idle()
    flows.study.active = true
    const h = setup('/reader/p/study', flows)

    h.go('/reader')
    await waitFor(() => expect(flows.study.close).toHaveBeenCalledTimes(1))
    expect(h.path()).toBe('/reader')
  })

  it('返回到另一篇/另一层时也关掉当前会话', async () => {
    const flows = idle()
    flows.write.active = true
    const h = setup('/reader/a/my-article/p/write', flows)

    h.go('/reader/a/my-article')
    await waitFor(() => expect(flows.write.close).toHaveBeenCalled())
    expect(h.path()).toBe('/reader/a/my-article')
  })
})

describe('useRoutedFlows：从布尔面板打开的整页会话（?back=）', () => {
  it('精读面板里开考试 → URL 记住 back；页面内退出回精读，不回文章', async () => {
    const flows = idle()
    const h = setup('/reader/a/my-article/p/intensive', flows)

    flows.quiz.active = true
    h.update(flows)
    await waitFor(() => expect(h.path()).toBe('/reader/a/my-article/p/quiz?back=intensive'))

    flows.quiz.active = false
    h.update(flows)
    await waitFor(() => expect(h.path()).toBe('/reader/a/my-article/p/intensive'))
  })

  it('浏览器返回精读那一层 → 关掉考试，不再额外导航', async () => {
    const flows = idle()
    flows.quiz.active = true
    const h = setup('/reader/a/my-article/p/quiz?back=intensive', flows)

    h.go('/reader/a/my-article/p/intensive')
    await waitFor(() => expect(flows.quiz.close).toHaveBeenCalledTimes(1))
    expect(h.path()).toBe('/reader/a/my-article/p/intensive')
  })

  it('深链接打不开 → 退回 back 面板，不留空界面', async () => {
    const flows = idle()
    const h = setup('/reader/a/my-article/p/quiz?back=intensive', flows)

    await waitFor(() => expect(flows.quiz.open).toHaveBeenCalled())
    await waitFor(() => expect(h.path()).toBe('/reader/a/my-article/p/intensive'))
  })
})

describe('useRoutedFlows：浮层会话（速读里的语言点）', () => {
  it('速读里打开语言点 → push 一层 /p/speed/lang，底下的速读留在地址里', async () => {
    const flows = idle()
    const h = setup('/reader/a/my-article/p/speed', flows)

    flows.lang.active = true
    h.update(flows)

    await waitFor(() => expect(h.path()).toBe('/reader/a/my-article/p/speed/lang'))
  })

  it('页面内关掉语言点 → replace 回速读，不掉回阅读主界面', async () => {
    const flows = idle()
    flows.lang.active = true
    const h = setup('/reader/a/my-article/p/speed/lang', flows)

    flows.lang.active = false
    h.update(flows)

    await waitFor(() => expect(h.path()).toBe('/reader/a/my-article/p/speed'))
  })

  it('浏览器返回到速读那一层 → 只关语言点，不额外导航', async () => {
    const flows = idle()
    flows.lang.active = true
    const h = setup('/reader/a/my-article/p/speed/lang', flows)

    h.go('/reader/a/my-article/p/speed')
    await waitFor(() => expect(flows.lang.close).toHaveBeenCalledTimes(1))
    expect(h.path()).toBe('/reader/a/my-article/p/speed')
  })

  it('深链接打不开语言点 → 退回速读（不是退回文章）', async () => {
    const flows = idle() // open 是空 spy，状态不会变
    const h = setup('/reader/a/my-article/p/speed/lang', flows)

    await waitFor(() => expect(flows.lang.open).toHaveBeenCalled())
    await waitFor(() => expect(h.path()).toBe('/reader/a/my-article/p/speed'))
  })

  it('整页会话不往路径上叠，但用 back 记住底下的速读', async () => {
    const flows = idle()
    const h = setup('/reader/a/my-article/p/speed', flows)

    flows.study.active = true
    h.update(flows)

    await waitFor(() => expect(h.path()).toBe('/reader/a/my-article/p/study?back=speed'))

    flows.study.active = false
    h.update(flows)
    await waitFor(() => expect(h.path()).toBe('/reader/a/my-article/p/speed'))
  })
})

describe('useRoutedFlows：深链接', () => {
  it('会话已经开着时保持 URL（不重复 open、不回落）', async () => {
    const flows = idle()
    flows.study.active = true
    const h = setup('/reader/p/study', flows)

    await Promise.resolve()
    expect(flows.study.open).not.toHaveBeenCalled()
    expect(h.path()).toBe('/reader/p/study')
  })

  it('数据没就绪（词库还在加载）时先不开、也不判失败', async () => {
    const flows = idle()
    const h = setup('/reader/p/study', flows, false)

    await Promise.resolve()
    expect(flows.study.open).not.toHaveBeenCalled()
    expect(h.path()).toBe('/reader/p/study')

    h.update(flows, true)
    await waitFor(() => expect(flows.study.open).toHaveBeenCalled())
  })

  it('打不开（没词可背 / 没文章）→ 退回文章页，别停在空界面', async () => {
    const flows = idle() // open 是空 spy，状态不会变
    const h = setup('/reader/a/my-article/p/study', flows)

    await waitFor(() => expect(flows.study.open).toHaveBeenCalled())
    await waitFor(() => expect(h.path()).toBe('/reader/a/my-article'))
  })
})
