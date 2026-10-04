import type { VocabItem } from '../../types/document'
import { review, type ReviewGrade, type StudyMode } from '../../core/vocab'
import { fmtDue, fmtDur, fmtInterval } from '../format'

/** 背单词范围。 */
export type StudyScope = 'all' | 'article' | 'unmastered' | 'lapses'

/** 卡内编辑草稿。 */
export interface StudyDraft {
  word: string
  phonetic: string
  partOfSpeech: string
  meaning: string
  usage: string
}

export interface StudyPanelProps {
  card: VocabItem | null
  queueLength: number
  index: number
  mode: StudyMode
  scope: StudyScope
  spelling: boolean
  revealed: boolean
  checked: boolean
  input: string
  counts: { know: number; fuzzy: number; forgot: number }
  cardSeconds: number
  liveSeconds: number
  grandSeconds: number
  newCount: number
  dueCount: number
  newLimit: number
  newToday: number
  gradeInfo: string
  editOpen: boolean
  draft: StudyDraft | null
  delArmed: boolean
  forgotCount: number

  onClose: () => void
  onExam: () => void
  onSwitchMode: (mode: StudyMode) => void
  onSwitchScope: (scope: StudyScope) => void
  onStartArticleAll: () => void
  onNewLimitChange: (n: number) => void
  onSpellingChange: (on: boolean) => void
  onReveal: () => void
  onInputChange: (value: string) => void
  onCheckSpelling: () => void
  onSpeak: (word: string) => void
  onOpenEdit: () => void
  onDelete: () => void
  onDraftChange: (draft: StudyDraft) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onGrade: (grade: ReviewGrade) => void
  onRetryForgot: () => void
  onRestart: () => void
}

/** 背单词 / 快刷主界面：卡片、卡内维护、SRS 评分、本轮小结。逻辑在外层。 */
export default function StudyPanel({
  card,
  queueLength,
  index,
  mode,
  scope,
  spelling,
  revealed,
  checked,
  input,
  counts,
  cardSeconds,
  liveSeconds,
  grandSeconds,
  newCount,
  dueCount,
  newLimit,
  newToday,
  gradeInfo,
  editOpen,
  draft,
  delArmed,
  forgotCount,
  onClose,
  onExam,
  onSwitchMode,
  onSwitchScope,
  onStartArticleAll,
  onNewLimitChange,
  onSpellingChange,
  onReveal,
  onInputChange,
  onCheckSpelling,
  onSpeak,
  onOpenEdit,
  onDelete,
  onDraftChange,
  onSaveEdit,
  onCancelEdit,
  onGrade,
  onRetryForgot,
  onRestart,
}: StudyPanelProps) {
  const spellingFront = spelling && !checked
  const canGrade = spelling ? checked : revealed
  const correct = card ? input.trim().toLowerCase() === card.word.trim().toLowerCase() : false

  return (
    <div className="study">
      <div className="bar study-bar">
        <button onClick={onClose}>结束（Esc）</button>
        <button onClick={onExam} title="直接考试：拼写 / 例句填空 / 搭配填空 / 听力填空">
          考试
        </button>
        <span className="view-toggle" title="新学习：还没学过的词；复习：学过且到期的词（切换会立即重开一轮）">
          <button className={mode === 'learn' ? 'primary' : ''} onClick={() => onSwitchMode('learn')}>
            新学习 {newCount}
          </button>
          <button className={mode === 'review' ? 'primary' : ''} onClick={() => onSwitchMode('review')}>
            复习 {dueCount}
          </button>
        </span>
        <select value={scope} onChange={(e) => onSwitchScope(e.target.value as StudyScope)} title="背词范围；改完立即按新范围重开一轮">
          <option value="article">本篇（只背这篇）</option>
          <option value="unmastered">未掌握</option>
          <option value="lapses">错词</option>
          <option value="all">全部</option>
        </select>
        <button onClick={onStartArticleAll} title="把这篇文章的生词整套过一遍（不分新学/复习、忽略新词配额）">
          本篇全部
        </button>
        <select
          value={String(newLimit)}
          onChange={(e) => onNewLimitChange(Number(e.target.value))}
          title="每天最多引入多少新词（下一轮生效）"
        >
          <option value="0">新词不限</option>
          <option value="10">新词 10/天</option>
          <option value="20">新词 20/天</option>
          <option value="30">新词 30/天</option>
          <option value="50">新词 50/天</option>
        </select>
        <label className="check-inline" title="看中文拼英文">
          <input
            type="checkbox"
            checked={spelling}
            onChange={(e) => onSpellingChange(e.target.checked)}
          />
          拼写
        </label>
        <span className="muted">
          {Math.min(index + 1, queueLength)} / {queueLength}
          {mode === 'learn' && newLimit > 0 ? ` · 新词 ${newToday}/${newLimit}` : ''}
        </span>
        <span
          className={'study-timer' + (cardSeconds >= 25 ? ' slow' : cardSeconds >= 12 ? ' warn' : '')}
          title="这张卡停了多久；变红就是该翻面/评分了"
        >
          ⏱ {cardSeconds}s{cardSeconds >= 25 ? ' · 别墨迹' : ''}
        </span>
        <span className="muted study-total" title="本轮 / 累计 背单词时长；累计会记入统计">
          本轮 {fmtDur(liveSeconds)} · 累计 {fmtDur(grandSeconds)}
        </span>
      </div>

      {card ? (
        <>
          <div className="study-card" onClick={spellingFront ? undefined : onReveal}>
            {spellingFront ? (
              <div className="study-prompt">
                <div className="study-meaning">
                  {card.partOfSpeech && <span className="cell-pos">{card.partOfSpeech} </span>}
                  {card.meaning ?? '（无释义）'}
                </div>
                <input
                  className="study-input"
                  autoFocus
                  placeholder="拼出这个英文单词，回车检查"
                  value={input}
                  onChange={(e) => onInputChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      onCheckSpelling()
                    }
                  }}
                />
              </div>
            ) : (
              <>
                <div className="study-word">
                  {card.word}
                  <button
                    className="speak"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSpeak(card.word)
                    }}
                    title="朗读"
                  >
                    🔊
                  </button>
                </div>
                {card.phonetic && (
                  <div
                    className="study-phon"
                    title="点读发音"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSpeak(card.word)
                    }}
                  >
                    {card.phonetic}
                  </div>
                )}
                {card.usage.length > 0 && <div className="study-usage">{card.usage.join('；')}</div>}
                {spelling && checked && (
                  <div className={'study-result ' + (correct ? 'ok' : 'bad')}>
                    {correct ? '✔ 正确' : `✘ 你写的是「${input || '（空）'}」`}
                  </div>
                )}
                {(revealed || (spelling && checked)) && (
                  <div className="study-back">
                    <div className="study-meaning">
                      {card.partOfSpeech && <span className="cell-pos">{card.partOfSpeech} </span>}
                      {card.meaning ?? '（无释义）'}
                    </div>
                    {card.examples.slice(0, 1).map((ex, i) => (
                      <div className="ex" key={i}>
                        {ex.text}
                        {ex.translation ? ` — ${ex.translation}` : ''}
                      </div>
                    ))}
                    {card.source?.sentenceText && <div className="muted src">来源：{card.source.sentenceText}</div>}
                    {card.confusables && card.confusables.length > 0 && (
                      <div className="muted study-conf">
                        易混：
                        {card.confusables.map((c) => `${c.word}${c.meaning ? `（${c.meaning}）` : ''}`).join('；')}
                      </div>
                    )}
                    <div className="muted study-srs">
                      复习 {card.reviewState.repetitions} 次
                      {(card.reviewState.lapses ?? 0) > 0 ? ` · 忘记 ${card.reviewState.lapses} 次` : ''}
                      {card.reviewState.due ? ` · 下次 ${fmtDue(card.reviewState.due)}` : ' · 还没排期'}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 卡内维护：改词形/释义、删误加的词 */}
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
                用法（分号分隔）
                <input
                  value={draft.usage}
                  onChange={(e) => onDraftChange({ ...draft, usage: e.target.value })}
                  placeholder="run a business；run out"
                />
              </label>
              <div className="bar">
                <button className="primary" onClick={onSaveEdit}>
                  保存
                </button>
                <button onClick={onCancelEdit}>取消</button>
              </div>
            </div>
          )}

          {canGrade ? (
            <>
              <div className="muted grade-preview">
                预计下次：认识 {fmtInterval(review(card.reviewState, 'good').interval)} · 模糊{' '}
                {fmtInterval(review(card.reviewState, 'hard').interval)} · 忘记了{' '}
                {fmtInterval(review(card.reviewState, 'again').interval)}
              </div>
              <div className="bar study-actions">
                <button className="primary" onClick={() => onGrade('good')}>
                  认识 <kbd>1</kbd>
                </button>
                <button onClick={() => onGrade('hard')}>
                  模糊 <kbd>2</kbd>
                </button>
                <button onClick={() => onGrade('again')}>
                  忘记了 <kbd>3</kbd>
                </button>
              </div>
            </>
          ) : spellingFront ? (
            <button className="primary" onClick={onCheckSpelling}>
              检查（回车）
            </button>
          ) : (
            <button className="primary" onClick={onReveal}>
              显示释义（空格）
            </button>
          )}
        </>
      ) : (
        <div className="study-done">
          <p>
            本轮完成：认识 <b>{counts.know}</b> · 模糊 <b>{counts.fuzzy}</b> · 忘记了 <b>{counts.forgot}</b>，用时{' '}
            {fmtDur(liveSeconds)}。
          </p>
          <div className="bar">
            {forgotCount > 0 && (
              <button className="primary" onClick={onRetryForgot}>
                重练忘记的 {forgotCount} 个
              </button>
            )}
            <button className={forgotCount ? '' : 'primary'} onClick={onRestart}>
              再来一轮（{mode === 'review' ? '复习' : '新学习'}）
            </button>
            <button onClick={onExam}>考试</button>
            <button onClick={onClose}>回到阅读</button>
          </div>
        </div>
      )}
    </div>
  )
}
