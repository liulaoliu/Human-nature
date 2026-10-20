import type { ComponentProps } from 'react'
import type { ReviewGrade } from '../core/vocab'
import type { VocabItem } from '../types/document'
import SpeedReadPanel from './panels/SpeedReadPanel'
import LanguageEditor from './panels/LanguageEditor'
import PlanPanel from './panels/PlanPanel'
import IntensivePanel from './panels/IntensivePanel'
import GoalPanel from './panels/GoalPanel'
import ExportPanel from './panels/ExportPanel'
import JournalPanel from './panels/JournalPanel'
import VocabList, { type VocabEditPatch } from './VocabList'

/**
 * 浮层面板的**路由与接线**：速读 / 语言点 / 计划 / 包围战 / 目标 / 导出 / 日志 / 全部生词。
 *
 * 为什么单独一个宿主：
 *   - 这些面板只在特定开关下出现，`ReaderApp` 里原来是一长串「开关 && <面板 十几个 prop>」；
 *   - 面板自己的 props 形状由面板定义（这里用 `ComponentProps` 取），`ReaderApp` 不再重复抄一遍；
 *   - 关着的面板不渲染，和之前的条件渲染语义完全一致。
 */
export interface ReaderOverlaysHostProps {
  speed: { open: boolean } & ComponentProps<typeof SpeedReadPanel>
  lang: { open: boolean } & ComponentProps<typeof LanguageEditor>
  plan: { open: boolean } & ComponentProps<typeof PlanPanel>
  intensive: { open: boolean } & ComponentProps<typeof IntensivePanel>
  goal: { open: boolean } & ComponentProps<typeof GoalPanel>
  exporter: { open: boolean } & ComponentProps<typeof ExportPanel>
  journal: { open: boolean } & ComponentProps<typeof JournalPanel>
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
      {speedOpen && <SpeedReadPanel {...speedProps} />}

      {langOpen && <LanguageEditor {...langProps} />}

      {planOpen && <PlanPanel {...planProps} />}

      {intensiveOpen && <IntensivePanel {...intensiveProps} />}

      {goalOpen && <GoalPanel {...goalProps} />}

      {exportOpen && <ExportPanel {...exportProps} />}

      {journalOpen && <JournalPanel {...journalProps} />}

      {allVocab.open && (
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
      )}
    </>
  )
}
