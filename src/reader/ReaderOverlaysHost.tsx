import { lazy, Suspense, type ComponentProps, type ReactNode } from 'react'
import type { ReviewGrade } from '../core/vocab'
import type { VocabItem } from '../types/document'
import type { VocabEditPatch } from './VocabList'
import PanelBoundary from './panels/PanelBoundary'

/**
 * 面板一律**按需加载**。
 *
 * 这些面板只在某个开关打开时才出现，以前是静态 import，代价是：
 * dev 模式下首屏要白白多拉几十个模块（每个模块一个请求 + 一次按需转译），
 * 生产里也被打进同一个 bundle。改成 `lazy` 之后，首屏只留外壳与正文。
 *
 * 类型仍然取自真实组件（`import type` 不产生运行时代码），
 * 所以下面 `ComponentProps<...>` 的形状和以前完全一致。
 */
import type SpeedReadPanelType from './panels/SpeedReadPanel'
import type LanguageEditorType from './panels/LanguageEditor'
import type PlanPanelType from './panels/PlanPanel'
import type IntensivePanelType from './panels/IntensivePanel'
import type GoalPanelType from './panels/GoalPanel'
import type ExportPanelType from './panels/ExportPanel'
import type JournalPanelType from './panels/JournalPanel'

const SpeedReadPanel = lazy(() => import('./panels/SpeedReadPanel'))
const LanguageEditor = lazy(() => import('./panels/LanguageEditor'))
const PlanPanel = lazy(() => import('./panels/PlanPanel'))
const IntensivePanel = lazy(() => import('./panels/IntensivePanel'))
const GoalPanel = lazy(() => import('./panels/GoalPanel'))
const ExportPanel = lazy(() => import('./panels/ExportPanel'))
const JournalPanel = lazy(() => import('./panels/JournalPanel'))
const VocabList = lazy(() => import('./VocabList'))

/** 面板加载中的占位：只在第一次打开某个面板时出现一瞬，不做重活。 */
function PanelLoading({ onClose }: { onClose: () => void }) {
  return (
    <div className="panel-loading">
      正在加载面板…
      <button onClick={onClose}>取消</button>
    </div>
  )
}

/**
 * 单个面板的「Suspense + 错误边界」。
 *
 * 不能只在外层放一个 Suspense：一个 chunk 失败就会把同一层的其它面板一起换掉，
 * 而且异常会冒到整棵树。每个面板各包一层，失败只坏这一块。
 */
function Guarded({ name, onClose, children }: { name: string; onClose: () => void; children: ReactNode }) {
  return (
    <PanelBoundary name={name} onClose={onClose}>
      <Suspense fallback={<PanelLoading onClose={onClose} />}>{children}</Suspense>
    </PanelBoundary>
  )
}

/**
 * 浮层面板的**路由与接线**：速读 / 语言点 / 计划 / 包围战 / 目标 / 导出 / 日志 / 全部生词。
 *
 * 为什么单独一个宿主：
 *   - 这些面板只在特定开关下出现，`ReaderApp` 里原来是一长串「开关 && <面板 十几个 prop>」；
 *   - 面板自己的 props 形状由面板定义（这里用 `ComponentProps` 取），`ReaderApp` 不再重复抄一遍；
 *   - 关着的面板不渲染，和之前的条件渲染语义完全一致。
 */
export interface ReaderOverlaysHostProps {
  speed: { open: boolean } & ComponentProps<typeof SpeedReadPanelType>
  lang: { open: boolean } & ComponentProps<typeof LanguageEditorType>
  plan: { open: boolean } & ComponentProps<typeof PlanPanelType>
  intensive: { open: boolean } & ComponentProps<typeof IntensivePanelType>
  goal: { open: boolean } & ComponentProps<typeof GoalPanelType>
  exporter: { open: boolean } & ComponentProps<typeof ExportPanelType>
  journal: { open: boolean } & ComponentProps<typeof JournalPanelType>
  allVocab: {
    open: boolean
    items: VocabItem[]
    list: VocabItem[]
    view: 'card' | 'table'
    onViewChange: (view: 'card' | 'table') => void
    focusLemma: string | null
    confirmDel: string | null
    onSpeak: (word: string) => void
    onDelete: (id: string) => void
    onReview: (id: string, grade: ReviewGrade) => void
    onEdit: (id: string, patch: VocabEditPatch) => void
    onClose: () => void
    onExportAnki: (items: VocabItem[]) => void
    onPrint: (items: VocabItem[], title: string) => void
    onExportWrong: (items: VocabItem[]) => void
  }
}

export default function ReaderOverlaysHost({
  speed,
  lang,
  plan,
  intensive,
  goal,
  exporter,
  journal,
  allVocab,
}: ReaderOverlaysHostProps) {
  const { open: speedOpen, ...speedProps } = speed
  const { open: langOpen, ...langProps } = lang
  const { open: planOpen, ...planProps } = plan
  const { open: intensiveOpen, ...intensiveProps } = intensive
  const { open: goalOpen, ...goalProps } = goal
  const { open: exportOpen, ...exportProps } = exporter
  const { open: journalOpen, ...journalProps } = journal

  return (
    <>
      {speedOpen && (
        <Guarded name="速读" onClose={speedProps.onClose}>
          <SpeedReadPanel {...speedProps} />
        </Guarded>
      )}

      {langOpen && (
        <Guarded name="语言点" onClose={langProps.onClose}>
          <LanguageEditor {...langProps} />
        </Guarded>
      )}

      {planOpen && (
        <Guarded name="今日计划" onClose={planProps.onClose}>
          <PlanPanel {...planProps} />
        </Guarded>
      )}

      {intensiveOpen && (
        <Guarded name="精读工作流" onClose={intensiveProps.onClose}>
          <IntensivePanel {...intensiveProps} />
        </Guarded>
      )}

      {goalOpen && (
        <Guarded name="目标" onClose={goalProps.onClose}>
          <GoalPanel {...goalProps} />
        </Guarded>
      )}

      {exportOpen && (
        <Guarded name="导出" onClose={exportProps.onClose}>
          <ExportPanel {...exportProps} />
        </Guarded>
      )}

      {journalOpen && (
        <Guarded name="学习日志" onClose={journalProps.onClose}>
          <JournalPanel {...journalProps} />
        </Guarded>
      )}

      {allVocab.open && (
        <Guarded name="全部生词" onClose={allVocab.onClose}>
          <div className="all-vocab">
            <div className="bar">
              <strong>全部生词（{allVocab.items.length}）</strong>
              <span className="view-toggle">
                <button
                  className={allVocab.view === 'card' ? 'primary' : ''}
                  onClick={() => allVocab.onViewChange('card')}
                >
                  卡片
                </button>
                <button
                  className={allVocab.view === 'table' ? 'primary' : ''}
                  onClick={() => allVocab.onViewChange('table')}
                >
                  表格
                </button>
              </span>
              <button onClick={() => allVocab.onExportAnki(allVocab.items)} disabled={!allVocab.items.length}>
                整库 Anki CSV
              </button>
              <button
                onClick={() => allVocab.onPrint(allVocab.items, '全部生词')}
                disabled={!allVocab.items.length}
              >
                整库 A4 打印
              </button>
              <button
                onClick={() => allVocab.onExportWrong(allVocab.items)}
                disabled={!allVocab.items.some((w) => (w.reviewState.lapses ?? 0) > 0)}
              >
                导出错词
              </button>
              <button className="primary" onClick={allVocab.onClose}>
                关闭
              </button>
            </div>
            {allVocab.list.length ? (
              <VocabList
                items={allVocab.list}
                view={allVocab.view}
                focusLemma={allVocab.focusLemma}
                confirmDel={allVocab.confirmDel}
                onSpeak={allVocab.onSpeak}
                onDelete={allVocab.onDelete}
                onReview={allVocab.onReview}
                onEdit={allVocab.onEdit}
                showSource
              />
            ) : (
              <div className="muted">生词本是空的</div>
            )}
          </div>
        </Guarded>
      )}
    </>
  )
}
