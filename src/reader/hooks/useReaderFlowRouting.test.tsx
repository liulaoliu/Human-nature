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
  const startStudy = vi.fn()
  const closeStudy = vi.fn()
  const setQuizSetupOpen = vi.fn()
  const quickStart = vi.fn()
  const quickClose = vi.fn()
  const dictStart = vi.fn()
  const dictClose = vi.fn()
  const openListeningMode = vi.fn()
  const setListenOpen = vi.fn()
  const openWriting = vi.fn()
  const writingSetOpen = vi.fn()
  const openBack = vi.fn()
  const backClose = vi.fn()
  const openLangFor = vi.fn()
  const setLangOpen = vi.fn()
  const setComposing = vi.fn()
  const cancelWarmup = vi.fn()
  const forceClose = vi.fn()

  const services = {
    studyQueue: null,
    startStudy,
    closeStudy,
    quizApi: { cancelWarmup, forceClose },
    quizSetupOpen: false,
    setQuizSetupOpen,
    quizQueue: null,
    quizWarmup: null,
    quickQueue: null,
    quickApi: { start: quickStart, close: quickClose },
    dictApi: { queue: null, start: dictStart, close: dictClose },
    listenOpen: false,
    setListenOpen,
    openListeningMode,
    writingOpen: false,
    writingApi: { setOpen: writingSetOpen },
    openWriting,
    backOpen: false,
    backApi: { close: backClose },
    openBack,
  } as unknown as ReturnType<typeof useSessionServices>

  const workspace = {
    composing: false,
    setComposing,
    langOpen: false,
    setLangOpen,
    openLangFor,
  } as unknown as ReturnType<typeof useArticleWorkspace>

  const route: ReaderRoute = { slug: 'my-article', panel: '' }
  renderHook(() =>
    useReaderFlowRouting(route, 'my-article', { services, workspace, sentence: null, ready }),
  )

  return {
    flows: captured.flows!,
    startStudy,
    closeStudy,
    setQuizSetupOpen,
    quickStart,
    quickClose,
    dictStart,
    dictClose,
    openListeningMode,
    setListenOpen,
    openWriting,
    writingSetOpen,
    openBack,
    backClose,
    openLangFor,
    setLangOpen,
    setComposing,
    cancelWarmup,
    forceClose,
  }
}

describe('useReaderFlowRouting：字段映射', () => {
  it('把 route / slug / ready 和九个整页面板都交给 useRoutedFlows', () => {
    const { flows } = setup(false)
    expect(captured.route).toEqual({ slug: 'my-article', panel: '' })
    expect(captured.slug).toBe('my-article')
    expect(captured.ready).toBe(false)
    expect(Object.keys(flows).sort()).toEqual(
      ['compose', 'dict', 'listen', 'lang', 'quick', 'quiz', 'study', 'write', 'back'].sort(),
    )
  })

  it('每个 flow 的 open/close 都指向自己的函数', () => {
    const s = setup()
    s.flows.study.open()
    s.flows.study.close()
    expect(s.startStudy).toHaveBeenCalledOnce()
    expect(s.closeStudy).toHaveBeenCalledOnce()

    s.flows.quiz.open()
    expect(s.setQuizSetupOpen).toHaveBeenCalledWith(true)

    s.flows.quick.open()
    s.flows.quick.close()
    expect(s.quickStart).toHaveBeenCalledOnce()
    expect(s.quickClose).toHaveBeenCalledOnce()

    s.flows.dict.open()
    s.flows.dict.close()
    expect(s.dictStart).toHaveBeenCalledOnce()
    expect(s.dictClose).toHaveBeenCalledOnce()

    s.flows.listen.open()
    s.flows.listen.close()
    expect(s.openListeningMode).toHaveBeenCalledWith(false)
    expect(s.setListenOpen).toHaveBeenCalledWith(false)

    s.flows.write.open()
    s.flows.write.close()
    expect(s.openWriting).toHaveBeenCalledOnce()
    expect(s.writingSetOpen).toHaveBeenCalledWith(false)

    s.flows.back.open()
    s.flows.back.close()
    expect(s.openBack).toHaveBeenCalledOnce()
    expect(s.backClose).toHaveBeenCalledOnce()

    s.flows.lang.open()
    s.flows.lang.close()
    expect(s.openLangFor).toHaveBeenCalledWith(null)
    expect(s.setLangOpen).toHaveBeenCalledWith(false)

    s.flows.compose.open()
    s.flows.compose.close()
    expect(s.setComposing).toHaveBeenNthCalledWith(1, true)
    expect(s.setComposing).toHaveBeenNthCalledWith(2, false)
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
