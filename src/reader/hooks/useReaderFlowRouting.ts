import type { Sentence } from '../../types/document'
import type { ReaderRoute } from '../route'
import type { useArticleWorkspace } from './useArticleWorkspace'
import { useRoutedFlows } from './useRoutedFlows'
import type { useSessionServices } from './useSessionServices'

export interface ReaderFlowRoutingParams {
  services: ReturnType<typeof useSessionServices>
  workspace: ReturnType<typeof useArticleWorkspace>
  /** 当前句（语言点编辑的对象）；没有就打开失败、由路由回落。 */
  sentence: Sentence | null
  /** 词库已加载：深链接 `/reader/p/study` 要等它，否则会被误判成「没词可背」。 */
  ready: boolean
}

/**
 * 把「整页会话 / 工具页」的开关接到 URL 上。
 *
 * ReaderApp 只负责传状态包；具体哪个字段对应哪个面板集中在这里，
 * 免得页面装配文件被几十行路由映射撑爆（也方便单独测映射）。
 *
 * 返回键语义见 `useRoutedFlows`：打开 push、返回关闭、页面内退出 replace。
 */
export function useReaderFlowRouting(
  route: ReaderRoute,
  slug: string,
  { services, workspace, sentence, ready }: ReaderFlowRoutingParams,
): void {
  const {
    studyQueue,
    startStudy,
    closeStudy,
    quizApi,
    quizSetupOpen,
    setQuizSetupOpen,
    quizQueue,
    quizWarmup,
    quickQueue,
    quickApi,
    dictApi,
    listenOpen,
    setListenOpen,
    openListeningMode,
    writingOpen,
    writingApi,
    openWriting,
  } = services
  const { composing, setComposing, langOpen, setLangOpen, openLangFor } = workspace

  useRoutedFlows(route, slug, {
    study: { active: !!studyQueue, open: startStudy, close: closeStudy },
    quiz: {
      active: quizSetupOpen || !!quizQueue || !!quizWarmup,
      open: () => setQuizSetupOpen(true),
      // 浏览器返回是明确退出：拼写判错也先关掉，别把用户卡在会话里
      close: () => {
        quizApi.cancelWarmup()
        quizApi.forceClose()
      },
    },
    quick: { active: !!quickQueue, open: quickApi.start, close: quickApi.close },
    dict: { active: !!dictApi.queue, open: dictApi.start, close: dictApi.close },
    listen: {
      active: listenOpen,
      open: () => openListeningMode(false),
      close: () => setListenOpen(false),
    },
    write: { active: writingOpen, open: openWriting, close: () => writingApi.setOpen(false) },
    lang: {
      active: langOpen,
      open: () => openLangFor(sentence),
      close: () => setLangOpen(false),
    },
    compose: {
      active: composing,
      open: () => setComposing(true),
      close: () => setComposing(false),
    },
  }, ready)
}
