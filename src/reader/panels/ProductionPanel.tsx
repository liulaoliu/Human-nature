import type { ProductionRouteState } from '../route'
import type { useProductionSession } from '../hooks/useProductionSession'
import ProductionHistoryView from './ProductionHistoryView'
import ProductionSetupView from './ProductionSetupView'
import ProductionRunView from './ProductionRunView'
import ProductionDoneView from './ProductionDoneView'

export interface ProductionPanelActions {
  /**
   * `/p/production` 的子视图 / 历史筛选。URL 是事实来源，解析与拼接都在 `route.ts`；
   * 面板只决定「点这个按钮要变成哪个状态」。
   */
  route?: ProductionRouteState
  onNavigate?: (state: ProductionRouteState, opts?: { replace?: boolean }) => void
}

export interface ProductionPanelProps extends ProductionPanelActions {
  model: ReturnType<typeof useProductionSession>
}

/**
 * D老师奶牛工棚：吃进去的是词块，挤出来的是自己的英文。
 *
 * 这一层只做壳：标题栏 + 子视图路由 + 「选草料 / 挤奶 / 收工」三屏切换。
 * 出题、批改、目标块硬校验、落盘在 `useProductionSession` / `core/production`；
 * 每一屏自己的表单状态在各自的 `Production*View` 里。
 */
export default function ProductionPanel({ model, route, onNavigate }: ProductionPanelProps) {
  const historyOpen = route?.view === 'history'
  // 打开 = push（返回键能退回工棚）；页面内关闭 = replace（返回键不经过已关掉的界面）。
  const openHistory = () => onNavigate?.({ ...route, view: 'history' })
  const closeHistory = () => onNavigate?.({ ...route, view: undefined }, { replace: true })
  const articleTitle = model.articleTitle

  if (historyOpen)
    return (
      <ProductionHistoryView
        open
        route={route}
        onNavigate={onNavigate}
        records={model.allHistory}
        progress={model.progress}
        articleIdentity={model.articleIdentity}
        articleTitle={articleTitle}
        onBack={closeHistory}
      />
    )

  return (
    <div className="study production">
      <div className="bar study-bar">
        <button
          onClick={model.close}
          title={model.stage === 'playing' ? '暂停这一组；未提交草稿会保留，下次回到这里继续' : '关闭工棚'}
        >
          {model.stage === 'playing' ? '暂停' : '关闭'}
        </button>
        <b>🐄 D老师奶牛工棚</b>
        <button onClick={openHistory} title="看产出历史、两稿对比和目标块趋势（地址会带 ?ph=1）">
          历史
        </button>
        <span className="muted">
          {model.stage === 'setup' ? '选草料' : model.stage === 'playing' ? '挤奶中' : '收工'}
          {articleTitle ? ` · ${articleTitle}` : ''}
        </span>
      </div>

      {model.stage === 'setup' && <ProductionSetupView model={model} />}
      {model.stage === 'playing' && model.current && (
        <ProductionRunView model={model} current={model.current} />
      )}
      {model.stage === 'done' && <ProductionDoneView model={model} />}
    </div>
  )
}
