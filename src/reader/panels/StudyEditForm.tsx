import type { StudyDraft } from '../hooks/useStudyCardEdit'

export interface StudyEditFormProps {
  draft: StudyDraft
  onDraftChange: (draft: StudyDraft) => void
  onSave: () => void
  onCancel: () => void
}

/** 卡内编辑表单：词形 / 音标 / 词性 / 释义（中英）/ 用法 / 词组 / 习语 / 语法标记。 */
export default function StudyEditForm({ draft, onDraftChange, onSave, onCancel }: StudyEditFormProps) {
  return (
    <div className="study-edit">
      <label>
        单词
        <input value={draft.word} onChange={(e) => onDraftChange({ ...draft, word: e.target.value })} />
      </label>
      <label>
        音标
        <input
          value={draft.phonetic}
          onChange={(e) => onDraftChange({ ...draft, phonetic: e.target.value })}
          placeholder="/.../"
        />
      </label>
      <label>
        词性
        <input
          value={draft.partOfSpeech}
          onChange={(e) => onDraftChange({ ...draft, partOfSpeech: e.target.value })}
          placeholder="n. / v. / adj."
        />
      </label>
      <label className="wide">
        释义
        <textarea
          value={draft.meaning}
          onChange={(e) => onDraftChange({ ...draft, meaning: e.target.value })}
          rows={2}
        />
      </label>
      <label className="wide">
        释义（英）
        <input
          value={draft.definition}
          onChange={(e) => onDraftChange({ ...draft, definition: e.target.value })}
          placeholder="to give up completely"
        />
      </label>
      <label className="wide">
        用法（分号分隔）
        <input
          value={draft.usage}
          onChange={(e) => onDraftChange({ ...draft, usage: e.target.value })}
          placeholder="run a business；run out"
        />
      </label>
      <label className="wide">
        词组（分号分隔）
        <input
          value={draft.phrases}
          onChange={(e) => onDraftChange({ ...draft, phrases: e.target.value })}
          placeholder="run out of；run a business"
        />
      </label>
      <label className="wide">
        习语（分号分隔）
        <input
          value={draft.idioms}
          onChange={(e) => onDraftChange({ ...draft, idioms: e.target.value })}
          placeholder="run in the family"
        />
      </label>
      <label className="wide">
        语法标记（分号分隔）
        <input
          value={draft.grammarMarks}
          onChange={(e) => onDraftChange({ ...draft, grammarMarks: e.target.value })}
          placeholder="可数；不可数 / 及物；不及物 / 可分级"
        />
      </label>
      <div className="bar">
        <button className="primary" onClick={onSave}>
          保存
        </button>
        <button onClick={onCancel}>取消</button>
      </div>
    </div>
  )
}
