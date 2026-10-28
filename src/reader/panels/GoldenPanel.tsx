import GoldenBankView from './golden/GoldenBankView'
import GoldenDrillView from './golden/GoldenDrillView'
import GoldenExamView from './golden/GoldenExamView'
import GoldenHome from './golden/GoldenHome'
import GoldenPlan from './golden/GoldenPlan'
import GoldenRecallView from './golden/GoldenRecallView'
import GoldenSummary from './golden/GoldenSummary'
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
  /** 打印本课 A4 */
  onPrintLesson?: () => void
  /** 仿写考试：完成 5/10 句后解锁，题目/批改/历史都在这一个 API 里 */
  exam?: GoldenExamApi
  /** 每句流程末尾的单句仿写；题目跟随当前句 */
  sentenceImitation?: GoldenImitationApi
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
  if (!api.open) return null
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
          onOpenBank={() => api.setView('bank')}
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
        <GoldenDrillView api={api} onSpeak={onSpeak} imitation={actions.sentenceImitation} />
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
