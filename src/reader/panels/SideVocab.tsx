
import { useMemo, useState } from 'react'
import VocabList, { type VocabEditPatch } from '../VocabList'
import type { VocabItem } from '../../types/document'
import { sortItems, type ReviewGrade, type VocabSortBy } from '../../core/vocab'
import { langEntries, wordEntries } from '../../core/entryKind'
import LangPointList from './LangPointList'
import { fmtDur } from '../format'
import { calendarDayKey } from '../../core/activity'

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
  /** 生词排序方式。 */
  sortBy: VocabSortBy
  onSortChange: (v: VocabSortBy) => void

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
  /** 本篇已有语言点的句子数（诊断/提示用）。 */
  languageCount: number
  /** 打开「今日计划」。 */
  onOpenPlan: () => void
  onOpenWriting: () => void
  onWrongPractice: () => void

  // 库 / 导出
  onBrowseAll: () => void
  onExportAnki: (items: VocabItem[], name?: string) => void
  onPrint: (
    items: VocabItem[],
    title: string,
    numberOf?: (item: VocabItem) => number | null,
    opts?: { groupBy?: 'alphabet' | 'article' | 'date' | 'status' },
  ) => void
  /** 打开「打印 / 导出」面板（按篇 / 按日期 / 未打印 / 全部）。 */
  onOpenExport: () => void
  printTitle: string
  onExportJson: () => void
  onExportWordList: (items: VocabItem[], name?: string) => void
  onCopyMissingPhonetic: (only: 'missing' | 'all') => void
  onToggleStats: () => void
  onExportWrong: (items: VocabItem[]) => void
  onExportAll: () => void
  /** 词库读取是否出错（出错时本次不写入任何东西，提供恢复入口） */
  libraryLoadFailed?: boolean
  /** 从「上一版」快照恢复词库 */
  onRestorePrev?: () => void
  /** 从本机其它记录（待选清单 / 错题本）找回词条 */
  onRescueLocal?: () => void
  /** 正文标记（Sentence.vocab）里能认出的词数 */
  markedWordCount?: number
  /** 从正文标记重建词条 */
  onRebuildFromMarks?: () => void
  /** **一次全捞**：正文标记 + 待选清单 + 错题本，再本地补释义 */
  onRecoverAll?: () => void
  onImportBackup: (file: File | undefined) => void
  onMergeBackup: (file: File | undefined) => void

  // 统计
  statsOpen: boolean
  stats: SideVocabStats
  onDailyGoalChange: (n: number) => void

  // 生词列表
  articleNums: Map<string, number>
  /** 本篇是否已全部打印（用于「已打印」标记，避免重复打印）。 */
  articleAllPrinted: boolean
  /** 本篇最近一次打印时间（ISO），没打印过为 null。 */
  articlePrintedAt: string | null
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
  sortBy,
  onSortChange,
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
  languageCount,
  onOpenPlan,
  onOpenWriting,
  onWrongPractice,
  onBrowseAll,
  onExportAnki,
  onPrint,
  onOpenExport,
  printTitle,
  onExportJson,
  onExportWordList,
  onCopyMissingPhonetic,
  onToggleStats,
  onExportWrong,
  onExportAll,
  libraryLoadFailed,
  onRestorePrev,
  onRescueLocal,
  markedWordCount,
  onRebuildFromMarks,
  onRecoverAll,
  onImportBackup,
  onMergeBackup,
  statsOpen,
  stats,
  onDailyGoalChange,
  articleNums,
  articleAllPrinted,
  articlePrintedAt,
  focusLemma,
  confirmDel,
  onJumpSource,
  onSpeak,
  onDelete,
  onReview,
  onEdit,
}: SideVocabProps) {
  const { totals, dayStats, last7, dueForecast, byArticle } = stats
  const printedDate = articlePrintedAt ? calendarDayKey(new Date(articlePrintedAt)) : ''
  /** 词库里还有多少「普通单词」（判断是不是被覆盖过） */
  const wordCount = useMemo(() => wordEntries(libraryItems).length, [libraryItems])
  const looksWiped = wordCount === 0 && libraryItems.length > 0

  /** 生词 / 语言点 两个页签：两类数据形状不同（单词 vs 词组·习语·用法说明），混在一列很难读 */
  const [tab, setTab] = useState<'word' | 'lang'>('word')
  const words = useMemo(() => wordEntries(articleWords), [articleWords])
  const langs = useMemo(() => langEntries(articleWords), [articleWords])
  /** 当前页签下要展示 / 打印的条目 */
  const shown = tab === 'word' ? words : langs
  const shownPrintTitle = tab === 'word' ? printTitle : printTitle + '·语言点'
  return (
    <div className="side-sec" data-sec="vocab">
      <div className="section-title">
        生词本 · 本篇（{articleWords.length}）
        <span className="view-toggle tab-toggle">
          <button className={tab === 'word' ? 'primary' : ''} onClick={() => setTab('word')} title="普通单词（要背/要考的那些）">
            生词（{words.length}）
          </button>
          <button
            className={tab === 'lang' ? 'primary' : ''}
            onClick={() => setTab('lang')}
            title="速读里 AI 总结的词组 / 习语 / 用法（自动收藏，可打印）"
          >
            语言点（{langs.length}）
          </button>
        </span>
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
        <select value={sortBy} onChange={(e) => onSortChange(e.target.value as VocabSortBy)} title="排序方式">
          <option value="updatedAt">最近改动</option>
          <option value="createdAt">加入时间</option>
          <option value="due">到期时间</option>
          <option value="word">字母</option>
        </select>
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
          {showLanguage ? '〔已开启〕' : '〔未开启 — 请勾选它〕'}
          {languageCount > 0 ? `（本篇 ${languageCount} 句）` : '（本篇 0 句）'}
        </label>
        <button onClick={onOpenWriting} disabled={!hasDoc} title="仿写：从范句生成任务 + 评分标准 → 你写 → AI 严格批改">
          仿写
        </button>
        <button onClick={onOpenPlan} title="今日计划：每日清单（自动打勾）+ 选材料建议">
          📋 今日计划
        </button>
        <button
          onClick={onWrongPractice}
          disabled={!hasLapses}
          title="错题专练：把所有「忘记了」过的词拉出来考"
        >
          错题专练
        </button>
      </div>

      {onRebuildFromMarks && (markedWordCount ?? 0) > 0 && (
        <div className="side-warn">
          📄 正文里还留着 <b>{markedWordCount}</b> 个标记过的词（当年粘回的 AI 词表，存在文章里，不受词库影响）。
          <button onClick={onRebuildFromMarks} style={{ marginLeft: 8 }}>
            从正文标记重建词库
          </button>
        </div>
      )}
      {onRecoverAll && looksWiped && (
        <div className="side-warn">
          <b>一键找回</b>：正文标记 {markedWordCount ?? 0} 个词 · 待选清单 · 错题本 —— 全部本地完成，不用 AI。
          <div style={{ marginTop: 6 }}>
            <button className="primary" onClick={onRecoverAll}>
              一键全部重建词库
            </button>
          </div>
        </div>
      )}
      {looksWiped && (
        <div className="side-warn">
          ⚠ 词库里**一个普通单词都没有**（只剩 {libraryItems.length} 条语言点），像是被覆盖过。按顺序试：
          <b>① 恢复上一版词库</b> → <b>② 找回词条</b>（从待选清单/错题本捞） →{' '}
          <b>③ 打印/导出 → 导入备份</b>（以前导出的 economist-backup-*.json）。
          实在没有备份就按篇重来：侧栏「用词典挑词」是**本地词典、不用 AI**，挑完再「补齐生词本」。
        </div>
      )}
      <div className="side-label">库 / 导出</div>
      {libraryLoadFailed && (
        <div className="side-warn">
          ⚠ 词库没读出来：本次**不会写入任何东西**（免得把空库覆盖回去）。先点下面「恢复上一版词库」，
          或刷新页面重试。
        </div>
      )}
      <div className="bar">
        <button onClick={onBrowseAll} disabled={!hasItems} title="查看全部生词（跨文章）">
          全部生词
        </button>
        <button onClick={() => onExportAnki(shown)} disabled={!shown.length} title="导出本篇（按当前类型过滤）为 Anki CSV">
          Anki（本篇）
        </button>
        <button
          onClick={() => onPrint(shown, shownPrintTitle, (it) => articleNums.get(it.lemma) ?? null)}
          disabled={!shown.length}
          title={
            articleAllPrinted
              ? `本篇已于 ${printedDate} 打印过；再点会重新打印（并刷新打印时间）`
              : '打印本篇生词（A4；按当前类型过滤）'
          }
        >
          {articleAllPrinted ? 'A4（本篇）✓' : 'A4（本篇）'}
        </button>
        {onRestorePrev && (
          <button
            onClick={onRestorePrev}
            title="把词库退回上一次覆盖前的版本（防误清 / 读取出错；取更完整的那一份）"
          >
            恢复上一版词库
          </button>
        )}
        {onRescueLocal && (
          <button
            onClick={onRescueLocal}
            title="从本机还留着的记录里把词找回来：待选清单（词 + 原句）+ 错题本。释义可再用「补齐生词本」本地补"
          >
            找回词条
          </button>
        )}
        <button onClick={() => onExportAnki(libraryItems)} disabled={!hasItems} title="导出整库生词为 Anki CSV">
          Anki（整库）
        </button>
        <button
          className="primary"
          onClick={onOpenExport}
          disabled={!hasItems}
          title="按篇 / 按日期 / 未打印 / 全部 —— 选范围与分组，再打印或导出"
        >
          🖨 打印 / 导出…
        </button>        <button onClick={onExportJson} disabled={!hasItems}>
          导出 JSON
        </button>
        <button
          onClick={() => onExportWordList(libraryItems)}
          disabled={!hasItems}
          title="导出纯单词表 TXT（每行一个单词，自动跳过词组），给外部词书 App 导入"
        >
          导出 TXT
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
        <label className="filebtn" title="导入备份并覆盖本机数据（还原用：词库整库替换、统计整段替换）">
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
        <label
          className="filebtn"
          title="合并导入：保留本机现有的文章/生词/统计，把备份并进来（生词按原形去重、统计按天累加）"
        >
          合并导入
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              onMergeBackup(e.target.files?.[0])
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

      {tab === 'word' && !words.length && langs.length > 0 && (
        <div className="side-warn">
          这篇没有普通单词，只有语言点 —— 点上面「语言点」页签看。
          若你**原来的生词本里本来是有词的**，多半是词库读取出了岔子：先点「恢复上一版词库」，
          不行再刷新页面。
        </div>
      )}
      {tab === 'lang' ? (
        <LangPointList
          items={sortItems(langs, sortBy)}
          onSpeak={onSpeak}
          onDelete={onDelete}
          onEdit={(it) => onEdit(it.id, {})}
          confirmDel={confirmDel}
        />
      ) : words.length ? (
        <VocabList
          items={sortItems(words, sortBy)}
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
