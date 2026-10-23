// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReaderRoute } from '../route'
import type { useArticleWorkspace } from './useArticleWorkspace'
import type { useSessionServices } from './useSessionServices'
import type { FlowControls } from './useRoutedFlows'

/** 只测「哪个字段接到哪个面板」，历史行为由 `useRoutedFlows.test` 负责。 */
const captured = vi.hoisted(() => ({
  route: null as ReaderRoute | null,
  slug: '',
  flows: null as FlowControls | null,
  ready: null as boolean | null,
}))

vi.mock('./useRoutedFlows', () => ({
  useRoutedFlows: (route: ReaderRoute, slug: string, flows: FlowControls, ready: boolean) => {
    captured.route = route
    captured.slug = slug
    captured.flows = flows
    captured.ready = ready
  },
}))

import { useReaderFlowRouting } from './useReaderFlowRouting'

function setup(ready = true) {
  const noop = vi.fn()
  const openListeningMode = vi.fn()
  const openLangFor = vi.fn()
  const setComposing = vi.fn()
  const cancelWarmup = vi.fn()
  const forceClose = vi.fn()

  const services = {
    studyQueue: null,
    startStudy: noop,
    closeStudy: noop,
    quizApi: { cancelWarmup, forceClose },
    quizSetupOpen: false,
    setQuizSetupOpen: noop,
    quizQueue: null,
    quizWarmup: null,
    quickQueue: null,
    quickApi: { start: noop, close: noop },
    dictApi: { queue: null, start: noop, close: noop },
    listenOpen: false,
    setListenOpen: noop,
    openListeningMode,
    writingOpen: false,
    writingApi: { setOpen: noop },
    openWriting: noop,
  } as unknown as ReturnType<typeof useSessionServices>

  const workspace = {
    composing: false,
    setComposing,
    langOpen: false,
    setLangOpen: noop,
    openLangFor,
  } as unknown as ReturnType<typeof useArticleWorkspace>

  const route: ReaderRoute = { slug: 'my-article', panel: '' }
  renderHook(() =>
    useReaderFlowRouting(route, 'my-article', { services, workspace, sentence: null, ready }),
  )

  return { flows: captured.flows!, openListeningMode, openLangFor, setComposing, cancelWarmup, forceClose }
}

describe('useReaderFlowRouting：字段映射', () => {
  it('把 route / slug / ready 和八个整页面板都交给 useRoutedFlows', () => {
    const { flows } = setup(false)
    expect(captured.route).toEqual({ slug: 'my-article', panel: '' })
    expect(captured.slug).toBe('my-article')
    expect(captured.ready).toBe(false)
    expect(Object.keys(flows).sort()).toEqual(
      ['compose', 'dict', 'listen', 'lang', 'quick', 'quiz', 'study', 'write'].sort(),
    )
  })

  it('听力 / 语言点 / 新建文章各开各的', () => {
    const { flows, openListeningMode, openLangFor, setComposing } = setup()
    flows.listen.open()
    expect(openListeningMode).toHaveBeenCalledWith(false)
    flows.lang.open()
    expect(openLangFor).toHaveBeenCalledWith(null)
    flows.compose.open()
    expect(setComposing).toHaveBeenCalledWith(true)
  })

  it('考试退出要能强制关掉（返回键不被「拼写判错」卡住）', () => {
    const { flows, cancelWarmup, forceClose } = setup()
    flows.quiz.close()
    expect(cancelWarmup).toHaveBeenCalled()
    expect(forceClose).toHaveBeenCalled()
  })
})
