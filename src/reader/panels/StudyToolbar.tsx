import type { StudyDeck } from '../../core/entryKind'
import type { StudyMode } from '../../core/vocab'
import { fmtDur } from '../format'
import type { StudyScope } from '../hooks/useStudyPool'

export interface StudyToolbarProps {
  index: number
  queueLength: number
  roundTotal: number
  extraCount: number
  mode: StudyMode
  deck: StudyDeck
  scope: StudyScope
  newLimit: number
  newToday: number
  dueCount: number
  newCount: number
  spelling: boolean
  drillAfter: number
  /** 学习模式每组多少词（0 = 跟随范围；本篇 = 全部）。 */
  groupSize: number
  onGroupSizeChange: (n: number) => void
  cardSeconds: number
  liveSeconds: number
  grandSeconds: number
  /** 卡片热度（0–4，越久越红）。 */
  heat: number
  /** 拼错判定未确认：锁住结束 / 上一个 / 下一个。 */
  navLocked?: boolean
  onClose: () => void
  onBack: () => void
  onNext: () => void
  onExam: () => void
  onSwitchMode: (mode: StudyMode) => void
  onSwitchDeck: (deck: StudyDeck) => void
  onSwitchScope: (scope: StudyScope) => void
  onStartArticleAll: () => void
  onNewLimitChange: (n: number) => void
  onDrillAfterChange: (n: number) => void
  onSpellingChange: (v: boolean) => void
}

/** 背单词顶栏：导航、模式/牌组/范围、新词配额、拼写与锤炼阈值、本轮/累计时长。 */
export default function StudyToolbar({
  index,
  queueLength,
  roundTotal,
  extraCount,
  mode,
  deck,
  scope,
  newLimit,
  newToday,
  dueCount,
  newCount,
  spelling,
  drillAfter,
  groupSize,
  onGroupSizeChange,
  cardSeconds,
  liveSeconds,
  grandSeconds,
  heat,
  navLocked = false,
  onClose,
  onBack,
  onNext,
  onExam,
  onSwitchMode,
  onSwitchDeck,
  onSwitchScope,
  onStartArticleAll,
  onNewLimitChange,
  onDrillAfterChange,
  onSpellingChange,
}: StudyToolbarProps) {
  return (
    <div className="bar study-bar">
      <button onClick={onClose} disabled={navLocked} title={navLocked ? '先确认拼写判错，再退出' : undefined}>
        结束（Esc）
      </button>
      <button onClick={onBack} disabled={navLocked || index <= 0} title="回到上一个单词（Q）">
        ← 上一个 <kbd>Q</kbd>
      </button>
      <button onClick={onNext} disabled={navLocked || index >= queueLength} title="下一个单词（E）；不评分，直接切换">
        <kbd>E</kbd> 下一个 →
      </button>
      <button onClick={onExam} disabled={navLocked} title="直接考试：拼写 / 例句填空 / 搭配填空 / 听力填空">
        考试
      </button>
      <span className="view-toggle" title="新学习：还没学过的词；复习：学过且到期的词（切换会立即重开一轮）">
        <button className={mode === 'learn' ? 'primary' : ''} onClick={() => onSwitchMode('learn')} disabled={navLocked}>
          新学习 {newCount}
        </button>
        <button className={mode === 'review' ? 'primary' : ''} onClick={() => onSwitchMode('review')} disabled={navLocked}>
          复习 {dueCount}
        </button>
      </span>
      <span className="view-toggle" title="背单词：普通单词；背搭配：词组 / 习语（切换会立即重开一轮）">
        <button className={deck === 'word' ? 'primary' : ''} onClick={() => onSwitchDeck('word')} disabled={navLocked}>
          背单词
        </button>
        <button
          className={deck === 'collocation' ? 'primary' : ''}
          onClick={() => onSwitchDeck('collocation')}
          disabled={navLocked}
        >
          背搭配
        </button>
      </span>
      <select value={scope} onChange={(e) => onSwitchScope(e.target.value as StudyScope)} disabled={navLocked} title="背词范围；改完立即按新范围重开一轮">
        <option value="article">本篇（只背这篇）</option>
        <option value="unmastered">未掌握</option>
        <option value="lapses">错词</option>
        <option value="all">全部</option>
      </select>
      <button onClick={onStartArticleAll} disabled={navLocked} title="把这篇文章的生词整套过一遍（不分新学/复习、忽略新词配额）">
        本篇全部
      </button>
      <select
        value={String(newLimit)}
        onChange={(e) => onNewLimitChange(Number(e.target.value))}
        disabled={navLocked}
        title="每天最多引入多少新词（下一轮生效）"
      >
        <option value="0">新词不限</option>
        <option value="10">新词 10/天</option>
        <option value="20">新词 20/天</option>
        <option value="30">新词 30/天</option>
        <option value="50">新词 50/天</option>
      </select>
      <label className="check-inline" title="看中文拼英文（会屏掉自动朗读，避免剧透）">
        <input
          type="checkbox"
          checked={spelling}
          onChange={(e) => onSpellingChange(e.target.checked)}
          disabled={navLocked}
        />
        拼写
      </label>
      <select
        value={String(groupSize)}
        onChange={(e) => onGroupSizeChange(Number(e.target.value))}
        disabled={navLocked || mode !== 'learn'}
        title="学习模式每组多少词：学完一组停下来，把这一组全部词拼写一遍（本篇范围默认整篇一组；换档下一组生效）"
      >
        <option value="0">每组跟本篇</option>
        <option value="5">每组 5 词</option>
        <option value="10">每组 10 词</option>
        <option value="20">每组 20 词</option>
        <option value="50">每组 50 词</option>
      </select>
      <select
        value={String(drillAfter)}
        onChange={(e) => onDrillAfterChange(Number(e.target.value))}
        disabled={navLocked}
        title="单卡停留超过多少秒进入「强制锤炼」（拼写/选义/搭配/听写），完成后才能评分"
      >
        <option value="0">不锤炼</option>
        <option value="30">30s 锤炼</option>
        <option value="45">45s 锤炼</option>
        <option value="60">60s 锤炼</option>
        <option value="90">90s 锤炼</option>
      </select>
      <span className="muted">
        {Math.min(index + 1, roundTotal || queueLength)} / {roundTotal || queueLength}
        {extraCount > 0 ? ` · 加练 ×${extraCount}` : ''}
        {mode === 'learn' && newLimit > 0 ? ` · 新词 ${newToday}/${newLimit}` : ''}
      </span>
      <span className={'study-timer heat-' + heat} title="这张卡停了多久；越久越红，到点会强制锤炼">
        ⏱ {cardSeconds}s{cardSeconds >= 25 ? ' · 别墨迹' : ''}
      </span>
      <span className="muted study-total" title="本轮 / 累计 背单词时长；累计会记入统计">
        本轮 {fmtDur(liveSeconds)} · 累计 {fmtDur(grandSeconds)}
      </span>
    </div>
  )
}
