import type { VocabItem } from '../../types/document'
import type { StudyDraft } from '../hooks/useStudyCardEdit'
import StudyEditForm from './StudyEditForm'

export interface StudyCardToolsProps {
  card: VocabItem
  delArmed: boolean
  gradeInfo: string
  editOpen: boolean
  draft: StudyDraft | null
  onOpenEdit: () => void
  onDelete: () => void
  onDraftChange: (draft: StudyDraft) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
}

/**
 * 卡内维护条：编辑 / 两步删除 / 补全提示 + 编辑表单。
 * 只要停在单词卡上就可用——判完等「下一词」、模糊待定、复习已判也都能改。
 */
export default function StudyCardTools({
  card,
  delArmed,
  gradeInfo,
  editOpen,
  draft,
  onOpenEdit,
  onDelete,
  onDraftChange,
  onSaveEdit,
  onCancelEdit,
}: StudyCardToolsProps) {
  return (
    <>
      <div className="bar study-tools">
        <button onClick={onOpenEdit} title="改单词/音标/词性/释义/用法（会持久保存）">
          ✎ 编辑
        </button>
        <button className={delArmed ? 'danger' : ''} onClick={onDelete} title="删除这个误加的词（两步确认）">
          {delArmed ? '确认删除' : '删除'}
        </button>
        {(!card.meaning || card.usage.length === 0) && (
          <button className="primary" onClick={onOpenEdit} title="补上释义 / 用法后，才能出「拼写 / 填空 / 听力」题">
            ＋ 补全释义/用法
          </button>
        )}
        {gradeInfo && <span className="grade-info">{gradeInfo}</span>}
      </div>

      {editOpen && draft && (
        <StudyEditForm draft={draft} onDraftChange={onDraftChange} onSave={onSaveEdit} onCancel={onCancelEdit} />
      )}
    </>
  )
}
