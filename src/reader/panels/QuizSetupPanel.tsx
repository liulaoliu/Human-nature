import { ARTICLE_KINDS, QUIZ_KIND_LABEL, type QuizKind } from '../../core/quiz'

/** 考试范围。 */
export type QuizScope = 'all' | 'article' | 'unmastered' | 'due' | 'lapses'

/** 范围的中文名（设置页与考试页共用）。 */
export const QUIZ_SCOPE_LABEL: Record<QuizScope, string> = {
  article: '本篇',
  unmastered: '未掌握',
  due: '到期',
  lapses: '错词',
  all: '全库',
}

const KIND_ORDER: QuizKind[] = ['spell', 'cloze', 'usage', 'listen', 'choice', 'meaning', 'ear']

export interface QuizSetupPanelProps {
  kinds: QuizKind[]
  scope: QuizScope
  limit: number
  auto: boolean
  unique: boolean
  speakAfter: boolean
  availableCount: number
  poolUnmastered: number
  /** 文章级测验题型与可出题数（按当前文章）。 */
  articleKinds: QuizKind[]
  articleAvailable: number
  onToggleKind: (kind: QuizKind, on: boolean) => void
  onToggleArticleKind: (kind: QuizKind, on: boolean) => void
  onScopeChange: (scope: QuizScope) => void
  onLimitChange: (n: number) => void
  onAutoChange: (on: boolean) => void
  onUniqueChange: (on: boolean) => void
  onSpeakChange: (on: boolean) => void
  onCancel: () => void
  onStart: () => void
  onStartArticle: () => void
}

/** 考试设置：题型 / 范围 / 题量 / 答题选项。 */
export default function QuizSetupPanel({
  kinds,
  scope,
  limit,
  auto,
  unique,
  speakAfter,
  availableCount,
  poolUnmastered,
  articleKinds,
  articleAvailable,
  onToggleKind,
  onToggleArticleKind,
  onScopeChange,
  onLimitChange,
  onAutoChange,
  onUniqueChange,
  onSpeakChange,
  onCancel,
  onStart,
  onStartArticle,
}: QuizSetupPanelProps) {
  return (
    <div className="study quiz-setup">
      <div className="bar study-bar">
        <strong>考试设置</strong>
        <button onClick={onCancel}>取消</button>
      </div>
      <div className="quiz-setup-body">
        <div className="quiz-field">
          <span className="muted">题型</span>
          <div className="bar">
            {KIND_ORDER.map((k) => (
              <label className="check-inline" key={k}>
                <input type="checkbox" checked={kinds.includes(k)} onChange={(e) => onToggleKind(k, e.target.checked)} />
                {QUIZ_KIND_LABEL[k]}
              </label>
            ))}
          </div>
        </div>
        <div className="quiz-field">
          <span className="muted">范围</span>
          <div className="bar">
            <select value={scope} onChange={(e) => onScopeChange(e.target.value as QuizScope)}>
              <option value="unmastered">未掌握</option>
              <option value="due">到期</option>
              <option value="lapses">错词</option>
              <option value="article">本篇</option>
              <option value="all">全部</option>
            </select>
          </div>
        </div>
        <div className="quiz-field">
          <span className="muted">题量</span>
          <div className="bar">
            <select value={String(limit)} onChange={(e) => onLimitChange(Number(e.target.value))}>
              <option value="10">10 题</option>
              <option value="20">20 题</option>
              <option value="50">50 题</option>
              <option value="0">全部</option>
            </select>
          </div>
        </div>
        <div className="quiz-field">
          <span className="muted">答题</span>
          <div className="bar">
            <label className="check-inline" title="答对/答错后自动进入下一题（答错会多停一会儿看答案）">
              <input type="checkbox" checked={auto} onChange={(e) => onAutoChange(e.target.checked)} />
              自动下一题
            </label>
            <label className="check-inline" title="每个单词只考一题、题型随机；关掉可让同一词出多种题型">
              <input type="checkbox" checked={unique} onChange={(e) => onUniqueChange(e.target.checked)} />
              每词一题 · 乱序
            </label>
            <label className="check-inline" title="答完自动朗读正确答案（练发音）">
              <input type="checkbox" checked={speakAfter} onChange={(e) => onSpeakChange(e.target.checked)} />
              答完朗读
            </label>
          </div>
        </div>
        <p className="muted">
          本次范围：<b>{QUIZ_SCOPE_LABEL[scope]}</b> · 可出 {availableCount} 题（未掌握约 {poolUnmastered} 题）。答对按「认识」、答错按「忘记了」计入复习排期。
        </p>
        <div className="bar">
          <button className="primary" onClick={onStart} disabled={!kinds.length}>
            开始考试
          </button>
        </div>

        <hr className="quiz-sep" />
        <div className="quiz-field">
          <span className="muted">文章测验（考理解/结构，不写复习排期）</span>
          <div className="bar">
            {ARTICLE_KINDS.map((k) => (
              <label className="check-inline" key={k}>
                <input
                  type="checkbox"
                  checked={articleKinds.includes(k)}
                  onChange={(e) => onToggleArticleKind(k, e.target.checked)}
                />
                {QUIZ_KIND_LABEL[k]}
              </label>
            ))}
          </div>
          <div className="bar">
            <button
              className="primary"
              onClick={onStartArticle}
              disabled={!articleKinds.length || articleAvailable <= 0}
              title={
                articleAvailable <= 0
                  ? '这篇还没有译文 / 语言点，先在「语言点 / 全文翻译」里生成'
                  : '按当前文章出题：英译中 / 中译英 / 功能词填空 / 句子排序 / 结构语法'
              }
            >
              开始文章测验{articleAvailable > 0 ? `（约 ${articleAvailable} 题）` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
