import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import GoldenBankView from './golden/GoldenBankView'
import GoldenDrillView from './golden/GoldenDrillView'
import GoldenExamView from './golden/GoldenExamView'
import GoldenHistoryView from './golden/GoldenHistoryView'
import GoldenHome from './golden/GoldenHome'
import GoldenErrorsView from './golden/GoldenErrorsView'
import GoldenPlan from './golden/GoldenPlan'
import GoldenRecallView from './golden/GoldenRecallView'
import GoldenSummary from './golden/GoldenSummary'
import type { WritingRecord } from '../../core/writing'
import type { ActivityCat } from '../../core/activity'
import type { WritingRecommendationGroup } from '../../core/writingErrors'
import type { GoldenRouteState } from '../route'
import type { WritingErrorCard } from '../../core/writingErrorReview'
import type { WritingErrorProgress } from '../../core/writingErrorProgress'
import type { GoldenExtraPoint } from '../../types/document'
import type { GoldenLangPointApi } from '../hooks/useGoldenLangPoint'
import type { GoldenApi, GoldenBankActions, GoldenExamApi, GoldenImitationApi } from './golden/types'

export interface GoldenPanelActions {
  /** 导出本课素材 Markdown */
  onExportMarkdown: () => void
  /** 复制 AI 金句课提示词（模块内入口；跑批也会自动排这一项）。 */
  onGenerate?: () => void
  /** 把本课词块带进仿写；没有就不显示按钮。 */
  onOpenWriting?: (mustUse: string[]) => void
  /** 全库金句本：行 + 导出/打印动作打包 */
  bank?: GoldenBankActions
  /** 本科的仿写 / 考试批改历史；`all` 是全库（含别的篇），默认只看 `article` */
  history?: { article: WritingRecord[]; all: WritingRecord[] }
  /** 错因复盘：历史聚合 + v11 复习状态；不把规则写进视图 */
  errors?: {
    onAddPoint?: (rec: WritingRecommendationGroup) => void
    writingErrorProgress?: readonly WritingErrorProgress[]
    onReviewAnswer?: (card: WritingErrorCard, correct: boolean) => void
    onPauseReview?: (card: WritingErrorCard) => void
    onResumeReview?: (card: WritingErrorCard) => void
    /** 错因订正 AI 批改：和仿写共用 writingHistory，source='goldenError' */
    setWritingHistory?: Dispatch<SetStateAction<WritingRecord[]>>
    flash?: (message: string) => void
    recordActivity?: (cat: ActivityCat, n?: number) => void
    extraPoints?: GoldenExtraPoint[]
    onRemovePoint?: (sentenceId: string, en: string) => void
    /** 到历史详情（recordKey + 范围）；由 ReaderApp 接到 URL */
    onOpenHistory?: (recordKey: string, scope: 'article' | 'all') => void
    /** 「去练」找不到当前文章句子时的可见提示 */
    onMissingSentence?: () => void
  }
  /** 当前 `/p/golden` query；没有就 undefined */
  goldenRoute?: GoldenRouteState
  /** 改 golden 子视图 / 历史详情；replace 用于关闭/详情翻页 */
  onNavigateGolden?: (state: GoldenRouteState, opts?: { replace?: boolean }) => void
  /** 打印当前范围的学习历史（A4） */
  onPrintHistory?: (rows: WritingRecord[], title: string) => void
  /** 打印本课 A4 */
  onPrintLesson?: () => void
  /** 仿写考试：完成 5/10 句后解锁，题目/批改/历史都在这一个 API 里 */
  exam?: GoldenExamApi
  /** 每句流程末尾的单句仿写；题目跟随当前句 */
  sentenceImitation?: GoldenImitationApi
  /** 每句可选的「语言点造句」；不影响句子进度 */
  langPoint?: GoldenLangPointApi
}

export interface GoldenPanelProps {
  api: GoldenApi
  articleTitle: string
  onSpeak: (text: string) => void
  /** 本课的导出 / 生成 / 仿写 / 金句本动作，统一从组合根注入。 */
  actions: GoldenPanelActions
}

/** D老师小课堂壳：只负责标题栏和视图路由，具体视图在 panels/golden/*。 */
export default function GoldenPanel({ api, articleTitle, onSpeak, actions }: GoldenPanelProps) {
  const { open, view, setView } = api
  const routeView = actions.goldenRoute?.view
  const canRoute = !!actions.onNavigateGolden
  const onNavigateGolden = actions.onNavigateGolden
  const viewRef = useRef(view)
  viewRef.current = view
  const syncingRef = useRef(false)
  const routeSeenRef = useRef(false)
  const urlSyncedRef = useRef(false)

  // URL → 视图：只在 route 变化时执行（深链接 / 浏览器返回），不跟本地点击抢写入。
  useEffect(() => {
    if (!open || !canRoute) {
      routeSeenRef.current = false
      urlSyncedRef.current = false
      syncingRef.current = false
      return
    }
    const first = !routeSeenRef.current
    routeSeenRef.current = true
    const target = routeView ?? 'home'
    if (first) {
      if (routeView && viewRef.current !== target) {
        syncingRef.current = true
        setView(target)
      }
      return
    }
    if (viewRef.current !== target) {
      syncingRef.current = true
      setView(target)
    }
  }, [open, canRoute, routeView, setView])

  // 视图 → URL：用户动作后写一次。打开子视图 push，页内回课程页 replace。
  useEffect(() => {
    if (!open || !canRoute || !onNavigateGolden) return
    if (syncingRef.current) {
      syncingRef.current = false
      return
    }
    const current = routeView ?? undefined
    const target = view === 'home' ? undefined : view
    const first = !urlSyncedRef.current
    urlSyncedRef.current = true
    if (target === current) return
    onNavigateGolden(
      view === 'home' ? {} : { view },
      { replace: view === 'home' || first },
    )
  }, [open, canRoute, view, routeView, onNavigateGolden])

  if (!open) return null

  const openErrors = () => setView('errors')
  const openHistory = () => setView('history')
  const backHome = () => setView('home')
  const backFromHistory = () => {
    if (actions.goldenRoute?.from === 'errors') {
      if (actions.onNavigateGolden) {
        actions.onNavigateGolden(
          {
            view: 'errors',
            ...(actions.goldenRoute?.scope ? { scope: actions.goldenRoute.scope } : {}),
          },
          { replace: true },
        )
      } else api.setView('errors')
      return
    }
    backHome()
  }
  const openHistoryRecord = (recordKey: string, scope: 'article' | 'all') => {
    actions.onNavigateGolden?.(
      { view: 'history', recordKey, scope, from: 'errors' },
    )
  }

  return (
    <div className="study golden">
      <div className="bar study-bar">
        <button onClick={api.close} title="退出 D老师小课堂（Esc）">
          退出
        </button>
        <b>D老师小课堂</b>
        <span className="muted">金句锤炼 · 快速掌握句型</span>
        {articleTitle && <span className="muted golden-art">{articleTitle}</span>}
        <span className="muted golden-count">
          {api.summary ? `掌握 ${api.summary.masteredTargets}/${api.summary.totalTargets} 个学习点` : ''}
        </span>
      </div>
      {api.view === 'home' && (
        <GoldenHome
          api={api}
          onGenerate={actions.onGenerate}
          bank={actions.bank}
          exam={actions.exam}
          history={actions.history}
          onOpenBank={() => api.setView('bank')}
          onOpenHistory={openHistory}
          onOpenErrors={openErrors}
        />
      )}
      {api.view === 'errors' && (
        <GoldenErrorsView
          rows={actions.history ?? { article: [], all: [] }}
          articleTitle={articleTitle}
          onBack={backHome}
          onAddPoint={actions.errors?.onAddPoint}
          writingErrorProgress={actions.errors?.writingErrorProgress}
          onReviewAnswer={actions.errors?.onReviewAnswer}
          onPauseReview={actions.errors?.onPauseReview}
          onResumeReview={actions.errors?.onResumeReview}
          setWritingHistory={actions.errors?.setWritingHistory}
          flash={actions.errors?.flash}
          recordActivity={actions.errors?.recordActivity}
          initialScope={actions.goldenRoute?.scope}
          onScopeChange={
            actions.onNavigateGolden
              ? (scope) => actions.onNavigateGolden?.({ view: 'errors', scope }, { replace: true })
              : undefined
          }
          extraPoints={actions.errors?.extraPoints}
          onRemovePoint={actions.errors?.onRemovePoint}
          onOpenHistory={actions.onNavigateGolden ? openHistoryRecord : undefined}
          onOpenSentence={(sentenceId) => {
            if (!api.startSentenceDrill(sentenceId)) {
              actions.errors?.onMissingSentence?.()
            }
            // 去练切到 drill；URL 由「视图 → URL」effect 统一写，别在这里再 CRUD query。
          }}
        />
      )}
      {api.view === 'history' && (
        <GoldenHistoryView
          rows={actions.history ?? { article: [], all: [] }}
          articleTitle={articleTitle}
          onBack={backFromHistory}
          onPrint={actions.onPrintHistory}
          focusRecordKey={actions.goldenRoute?.recordKey}
          initialScope={actions.goldenRoute?.scope}
          backLabel={actions.goldenRoute?.from === 'errors' ? '错因复盘' : '课程页'}
          onCloseDetail={
            actions.onNavigateGolden
              ? () =>
                  actions.onNavigateGolden?.(
                    {
                      view: 'history',
                      ...(actions.goldenRoute?.scope ? { scope: actions.goldenRoute.scope } : {}),
                      ...(actions.goldenRoute?.from === 'errors' ? { from: 'errors' as const } : {}),
                    },
                    { replace: true },
                  )
              : undefined
          }
          onOpenRecord={
            actions.onNavigateGolden
              ? (recordKey, scope) =>
                  actions.onNavigateGolden?.(
                    {
                      view: 'history',
                      recordKey,
                      scope,
                      ...(actions.goldenRoute?.from === 'errors' ? { from: 'errors' as const } : {}),
                    },
                    { replace: true },
                  )
              : undefined
          }
        />
      )}
      {api.view === 'bank' && (
        <GoldenBankView
          rows={actions.bank?.rows ?? []}
          onBack={() => api.setView('home')}
          onExportMarkdown={actions.bank?.onExportMarkdown}
          onExportAnki={actions.bank?.onExportAnki}
          onPrint={actions.bank?.onPrint}
        />
      )}
      {api.view === 'plan' && <GoldenPlan api={api} />}
      {api.view === 'drill' && (
        <GoldenDrillView
          api={api}
          onSpeak={onSpeak}
          imitation={actions.sentenceImitation}
          langPoint={actions.langPoint}
        />
      )}
      {api.view === 'recall' && <GoldenRecallView api={api} onSpeak={onSpeak} />}
      {api.view === 'exam' && actions.exam && (
        <GoldenExamView exam={actions.exam} onBack={() => api.setView('home')} />
      )}
      {api.view === 'summary' && (
        <GoldenSummary
          api={api}
          onExportMarkdown={actions.onExportMarkdown}
          onOpenWriting={actions.onOpenWriting}
          onSpeak={onSpeak}
          onPrint={actions.onPrintLesson}
        />
      )}
    </div>
  )
}
