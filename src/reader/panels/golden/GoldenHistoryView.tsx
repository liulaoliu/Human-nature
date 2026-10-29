import { useState } from 'react'
import GoldenFeedback from './GoldenFeedback'
import type { WritingRecord } from '../../../core/writing'

const SOURCE_LABEL: Record<NonNullable<WritingRecord['source']>, string> = {
  writing: '仿写',
  goldenSentence: '单句仿写',
  goldenExam: '整课考试',
}

type Scope = 'article' | 'all'

/**
 * D老师小课堂的「学习历史」：单句仿写 / 整课考试 + 当时的 AI 批改。
 *
 * 默认只看**本篇**（跟着当前文章走），可切「全部」跨篇回看 —— 和「回译存档」一个习惯。
 * 批改原文只存在 `writingHistory.feedback` 里，平时只在交卷瞬间显示。
 * 过滤规则在 `useGoldenFeature`（`isGoldenWritingRecord` + 本篇 id）；这里只切范围、不重算归属。
 */
export default function GoldenHistoryView({
  rows,
  articleTitle,
  onBack,
}: {
  /** `article` = 本篇，`all` = 全库（已按来源筛过，都是金句课记录） */
  rows: { article: WritingRecord[]; all: WritingRecord[] }
  articleTitle?: string
  onBack: () => void
}) {
  const [scope, setScope] = useState<Scope>('article')
  const [picked, setPicked] = useState<WritingRecord | null>(null)
  const list = [...(scope === 'all' ? rows.all : rows.article)].sort((a, b) => b.at.localeCompare(a.at))

  if (picked) {
    return (
      <div className="golden-body">
        <div className="bar golden-plan-bar">
          <button onClick={() => setPicked(null)}>← 历史列表</button>
          <b>{SOURCE_LABEL[picked.source ?? 'writing']}</b>
          <span className="muted">{new Date(picked.at).toLocaleString()}</span>
          {picked.articleTitle && <span className="muted">{picked.articleTitle}</span>}
          <button onClick={onBack}>课程页</button>
        </div>
        {picked.text && <div className="bt-source">{picked.text}</div>}
        <GoldenFeedback feedback={picked.feedback} model={picked.task?.model || picked.model} />
      </div>
    )
  }

  return (
    <div className="golden-body">
      <div className="bar golden-plan-bar">
        <button onClick={onBack}>← 课程页</button>
        <b>学习历史</b>
        <button onClick={() => setScope('article')} className={scope === 'article' ? 'primary' : ''}>
          本篇（{rows.article.length}）
        </button>
        <button onClick={() => setScope('all')} className={scope === 'all' ? 'primary' : ''}>
          全部（{rows.all.length}）
        </button>
        <span className="muted">{scope === 'article' ? articleTitle : '所有做过的金句课仿写 / 考试'}</span>
      </div>
      {list.length ? (
        <div className="bt-history-list">
          {list.map((rec, i) => (
            <button
              key={`${rec.at}-${i}`}
              className="bt-history-row"
              onClick={() => setPicked(rec)}
              title="点开看当时的完整批改"
            >
              <span className="muted">{new Date(rec.at).toLocaleString()}</span>
              <span className="ellipsis">{SOURCE_LABEL[rec.source ?? 'writing']}</span>
              <span className="muted ellipsis">
                {scope === 'all' ? rec.articleTitle || rec.articleId : rec.task?.task || rec.model}
              </span>
              <b>{rec.feedback.max > 0 ? `${rec.feedback.total}/${rec.feedback.max}` : '—'}</b>
            </button>
          ))}
        </div>
      ) : (
        <div className="muted">
          {scope === 'article'
            ? '本篇还没有记录：做完一句仿写或整课考试，批改会自动留在这里。'
            : '还没有任何金句课批改记录。'}
        </div>
      )}
    </div>
  )
}
