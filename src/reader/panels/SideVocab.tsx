import VocabList, { type VocabEditPatch } from '../VocabList'
import type { VocabItem } from '../../types/document'
import type { ReviewGrade } from '../../core/vocab'
import { fmtDur } from '../format'

export interface SideVocabStats {
  totals: { picked: number; seconds: number }
  dayStats: { todayPicked: number; streak: number }
  studyTodaySeconds: number
  studyTotalSeconds: number
  studyTotalCards: number
  studiedCount: number
  dailyGoal: number
  last7: { key: string; label: string; picked: number }[]
  dueForecast: { key: string; label: string; count: number }[]
  byArticle: [string, number][]
}

export interface SideVocabProps {
  articleWords: VocabItem[]
  libraryItems: VocabItem[]
  view: 'card' | 'table'
  onViewChange: (view: 'card' | 'table') => void

  // 学习 / 练习
  hasDoc: boolean
  hasItems: boolean
  hasLapses: boolean
  onStartStudy: () => void
  onStartArticleAll: () => void
  onStartExam: () => void
  onStartQuick: () => void
  onStartDictation: () => void
  onOpenListening: () => void
  /** 阅读理解（文本模式，复用同一套理解题）。 */
  onOpenReading: () => void
  /** 逐句速读（一次一句，先读再揭示，超时拷打）。 */
  onOpenSpeedRead: () => void
  listenCount: number
  onListenCountChange: (n: number) => void
  onLanguagePrompt: () => void
  showLanguage: boolean
  onShowLanguageChange: (on: boolean) => void
  onOpenWriting: () => void
  onWrongPractice: () => void

  // 库 / 导出
  onBrowseAll: () => void
  onExportAnki: (items: VocabItem[]) => void
  onPrint: (items: VocabItem[], title: string, numberOf?: (item: VocabItem) => number | null) => void
  printTitle: string
  onExportJson: () => void
  onCopyMissingPhonetic: (only: 'missing' | 'all') => void
  onToggleStats: () => void
  onExportWrong: (items: VocabItem[]) => void
  onExportAll: () => void
  onImportBackup: (file: File | undefined) => void

  // 统计
  statsOpen: boolean
  stats: SideVocabStats
  onDailyGoalChange: (n: number) => void

  // 生词列表
  articleList: VocabItem[]
  articleNums: Map<string, number>
  focusLemma: string | null
  confirmDel: string | null
  onJumpSource?: (item: VocabItem) => void
  onSpeak: (word: string) => void
  onDelete: (id: string) => void
  onReview: (id: string, grade: ReviewGrade) => void
  onEdit: (id: string, patch: VocabEditPatch) => void
}

/** 生词本 Tab：学习/练习入口、库/导出、每日统计、本篇词表。 */
export default function SideVocab({
  articleWords,
  libraryItems,
  view,
  onViewChange,
  hasDoc,
  hasItems,
  hasLapses,
  onStartStudy,
  onStartArticleAll,
  onStartExam,
  onStartQuick,
  onStartDictation,
  onOpenListening,
  onOpenReading,
  onOpenSpeedRead,
  listenCount,
  onListenCountChange,
  onLanguagePrompt,
  showLanguage,
  onShowLanguageChange,
  onOpenWriting,
  onWrongPractice,
  onBrowseAll,
  onExportAnki,
  onPrint,
  printTitle,
  onExportJson,
  onCopyMissingPhonetic,
  onToggleStats,
  onExportWrong,
  onExportAll,
  onImportBackup,
  statsOpen,
  stats,
  onDailyGoalChange,
  articleList,
  articleNums,
  focusLemma,
  confirmDel,
  onJumpSource,
  onSpeak,
  onDelete,
  onReview,
  onEdit,
}: SideVocabProps) {
  const { totals, dayStats, last7, dueForecast, byArticle } = stats
  return (
    <div className="side-sec" data-sec="vocab">
      <div className="section-title">
        生词本 · 本篇（{articleWords.length}）
        <span className="view-toggle">
          <button className={view === 'card' ? 'primary' : ''} onClick={() => onViewChange('card')}>
            卡片
          </button>
          <button
            className={view === 'table' ? 'primary' : ''}
            onClick={() => onViewChange('table')}
            title="像书本词汇表一样密排"
          >
            表格
          </button>
        </span>
      </div>
      <div className="side-label">学习 / 练习</div>
      <div className="bar">
        <button
          className="primary"
          onClick={onStartStudy}
          disabled={!hasItems}
          title="卡片式背单词：新学习没学过的、复习到期的；空格翻面，1/2/3 认识/模糊/忘记了，Esc 退出"
        >
          背单词
        </button>
        <button
          onClick={onStartArticleAll}
          disabled={!hasItems}
          title="本篇全部：把这篇文章的生词整套过一遍（不分新学/复习、忽略新词配额）"
        >
          本篇全部
        </button>
        <button
          onClick={onStartExam}
          disabled={!hasItems}
          title="考试：拼写 / 例句填空 / 搭配填空 / 听力填空 / 词形辨析，成绩计入复习排期"
        >
          考试
        </button>
        <button
          onClick={onStartQuick}
          disabled={!hasItems}
          title="快刷：只看单词+音标，1/← 不认识，2/→ 认识，空格看释义，Esc 退出"
        >
          快刷
        </button>
        <button
          onClick={onStartDictation}
          disabled={!hasDoc}
          title="逐句听写：按文章顺序播句子，听写整句或听音填空；Tab 重听，回车检查"
        >
          听写
        </button>
        <button
          onClick={onOpenListening}
          disabled={!hasDoc}
          title="听力理解题：AI 出题（带答案+解析）→ 本地判分；没题目时先复制出题提示词"
        >
          理解题
        </button>
        <button
          onClick={onOpenReading}
          disabled={!hasDoc}
          title="阅读理解（文本）：先展开原文再答同一套理解题，不依赖听"
        >
          阅读理解
        </button>
        <button
          onClick={onOpenSpeedRead}
          disabled={!hasDoc}
          title="逐句速读：一次一句，先自己读→空格看释义/语言点；超时算不太理解，来个填空拷打"
        >
          速读
        </button>
        <select
          value={String(listenCount)}
          onChange={(e) => onListenCountChange(Number(e.target.value))}
          title="听力理解题出题数量（点「理解题」用）"
        >
          <option value="5">5 题</option>
          <option value="8">8 题</option>
          <option value="10">10 题</option>
          <option value="15">15 题</option>
        </select>
        <button
          onClick={onLanguagePrompt}
          disabled={!hasDoc}
          title="逐句语言点分析（结构/语法/idiom/词组/用法）：复制提示词，粘回「应用结果」后写回句子"
        >
          语言点
        </button>
        <label className="check-inline" title="在正文里显示语言点（结构/语法/习语/词组/用法）">
          <input type="checkbox" checked={showLanguage} onChange={(e) => onShowLanguageChange(e.target.checked)} />
          显示语言点
        </label>
        <button onClick={onOpenWriting} disabled={!hasDoc} title="仿写：从范句生成任务 + 评分标准 → 你写 → AI 严格批改">
          仿写
        </button>
        <button
          onClick={onWrongPractice}
          disabled={!hasLapses}
          title="错题专练：把所有「忘记了」过的词拉出来考"
        >
          错题专练
        </button>
      </div>

      <div className="side-label">库 / 导出</div>
      <div className="bar">
        <button onClick={onBrowseAll} disabled={!hasItems} title="查看全部生词（跨文章）">
          全部生词
        </button>
        <button onClick={() => onExportAnki(articleWords)} disabled={!articleWords.length} title="导出本篇生词为 Anki CSV">
          Anki（本篇）
        </button>
        <button
          onClick={() => onPrint(articleWords, printTitle, (it) => articleNums.get(it.lemma) ?? null)}
          disabled={!articleWords.length}
          title="打印本篇生词（A4）"
        >
          A4（本篇）
        </button>
        <button onClick={() => onExportAnki(libraryItems)} disabled={!hasItems} title="导出整库生词为 Anki CSV">
          Anki（整库）
        </button>
        <button onClick={() => onPrint(libraryItems, '全部生词')} disabled={!hasItems} title="打印整库生词（A4）">
          A4（整库）
        </button>
        <button onClick={onExportJson} disabled={!hasItems}>
          导出 JSON
        </button>
        <button
          onClick={() => onCopyMissingPhonetic('missing')}
          disabled={!hasItems}
          title="给生词本里没有音标的词生成查词提示词；粘回结果即可补齐"
        >
          补查音标
        </button>
        <button onClick={() => onCopyMissingPhonetic('all')} disabled={!hasItems} title="给全部生词重新生成查词提示词">
          全部重查
        </button>
        <button onClick={onToggleStats} title="每日选词统计">
          统计
        </button>
        <button
          onClick={() => onExportWrong(libraryItems)}
          disabled={!libraryItems.some((it) => (it.reviewState.lapses ?? 0) > 0)}
          title="导出出错过的词（Word, Lapses, Meaning, Context）"
        >
          导出错词
        </button>
      </div>
      <div className="bar">
        <button onClick={onExportAll} title="词库 + 已保存的文章打包成一个 JSON，换电脑时带走">
          导出全部（备份）
        </button>
        <label className="filebtn" title="导入之前的备份 JSON（文章 + 生词）">
          导入备份
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              onImportBackup(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
      </div>

      {statsOpen && (
        <div className="stats">
          <div className="muted">
            累计 {totals.picked} 词 / {fmtDur(totals.seconds)} · 今日 {dayStats.todayPicked} · 连续 {dayStats.streak} 天
          </div>
          <div className="muted">
            背单词：今日 {fmtDur(stats.studyTodaySeconds)} · 累计 {fmtDur(stats.studyTotalSeconds)} · 完成{' '}
            {stats.studyTotalCards} 次评分
          </div>
          <div className="goal">
            <div className="muted">
              今日目标：{stats.studiedCount} / {stats.dailyGoal > 0 ? stats.dailyGoal : '不限'} · 🔥{dayStats.streak} 天
              <select
                value={String(stats.dailyGoal)}
                onChange={(e) => onDailyGoalChange(Number(e.target.value))}
                title="每日目标（按学过的不同单词数）"
              >
                <option value="0">不限</option>
                <option value="10">10 词</option>
                <option value="20">20 词</option>
                <option value="30">30 词</option>
                <option value="50">50 词</option>
              </select>
            </div>
            {stats.dailyGoal > 0 && (
              <div className="goal-bar">
                <div style={{ width: `${Math.min(100, (stats.studiedCount / stats.dailyGoal) * 100)}%` }} />
              </div>
            )}
          </div>
          <div className="stats-bars">
            {last7.map((d) => (
              <div className="stats-day" key={d.key} title={`${d.key}：${d.picked} 词`}>
                <div className="stats-col">
                  <div className="stats-bar" style={{ height: `${Math.min(100, d.picked * 8)}%` }} />
                </div>
                <div className="stats-label">{d.label}</div>
              </div>
            ))}
          </div>
          <div className="muted due-title">未来 30 天到期（颜色越深越多）</div>
          <div className="due-heat">
            {dueForecast.map((d) => (
              <div
                key={d.key}
                className={
                  'due-cell' +
                  (d.count >= 20 ? ' lv4' : d.count >= 10 ? ' lv3' : d.count >= 4 ? ' lv2' : d.count > 0 ? ' lv1' : '')
                }
                title={`${d.key}：${d.count} 词到期`}
              >
                <span>{d.label}</span>
              </div>
            ))}
          </div>
          {byArticle.length > 0 && (
            <div className="stats-articles">
              {byArticle.map(([name, n]) => (
                <div className="stats-article" key={name}>
                  <span className="muted ellipsis" title={name}>
                    {name}
                  </span>
                  <b>{n}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {articleList.length ? (
        <VocabList
          items={articleList}
          view={view}
          focusLemma={focusLemma}
          confirmDel={confirmDel}
          onJump={onJumpSource}
          onSpeak={onSpeak}
          onDelete={onDelete}
          onReview={onReview}
          onEdit={onEdit}
          numberOf={(it) => articleNums.get(it.lemma) ?? null}
        />
      ) : (
        <div className="muted empty-hint">这篇还没有生词；划词标记，或点「全部生词」看别的文章。</div>
      )}
    </div>
  )
}
