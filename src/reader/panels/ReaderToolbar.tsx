import { Fragment, type ReactNode } from 'react'
import ArticlePicker from '../ArticlePicker'
import type { ArticleBook } from '../../core/matchArticle'
import type { SavedArticle } from '../../core/ports'
import type { VocabLevel } from '../../core/analyzer'
import { isOfflineTtsVoice, type TtsAccent } from '../../core/ttsVoices'
import { fmtDur } from '../format'
import { TOOLBAR_WIDTHS, TOOLBAR_WIDTH_LABEL, toolbarWidthStyle, type ToolbarWidth } from '../../core/toolbarWidth'
import {
  TOOLBAR_ROWS_LABEL,
  TOOLBAR_ROW_MODES,
  planToolbarRows,
  toolbarRowClass,
  type ToolbarGroup,
  type ToolbarRowMode,
} from '../../core/toolbarRows'

export interface ReaderToolbarProps {
  // 内置文章选择
  book: ArticleBook | null
  editions: [string, number][]
  edition: string
  onEditionChange: (value: string) => void
  bookKeysCount: number
  saved: SavedArticle[]
  savedGroups: [string, SavedArticle[]][]
  shownKeys: string[]
  /** 文章标识 → 第一次读完的日期键（选择器里标「✓ 已读」并可只看未读） */
  readDays?: Record<string, string>
  currentValue: string
  onPickArticle: (value: string) => void

  // 文档 / 操作
  hasDoc: boolean
  editing: boolean
  savedId: string | null
  onSave: () => void
  onNewArticle: () => void
  vocabMode: boolean
  onToggleVocab: () => void
  onTranslateAll: () => void
  vocabLevel: VocabLevel
  onVocabLevelChange: (value: VocabLevel) => void
  onAutoVocab: () => void
  translateView: 'off' | 'below' | 'only'
  onTranslateViewChange: (value: 'off' | 'below' | 'only') => void
  autoSpeak: boolean
  onAutoSpeakChange: (on: boolean) => void
  selectedId: string | null
  onSpeakSelected: () => void
  readingAll: boolean
  onToggleReadAll: () => void
  onSpeedRead: () => void
  onOpenIntensive: () => void
  onOpenJournal: () => void
  onOpenGoals: () => void
  ttsState: 'idle' | 'loading' | 'playing'
  ttsVoice: string
  onTtsVoiceChange: (value: string) => void
  ttsAccents: TtsAccent[]
  pregenRunning: boolean
  pregenDone: number
  pregenTotal: number
  onPregenerate: () => void
  onCancelPregenerate: () => void
  pregenAllCached: boolean
  onEnterEdit: () => void

  // 编辑态
  draft: string
  onCleanupEdit: () => void
  onApplyEdit: () => void
  onCancelEdit: () => void

  // 统计
  vocabSeconds: number
  sessionPicked: number
  todayPicked: number
  streak: number
  totalPicked: number
  totalSeconds: number
  studiedCount: number
  dailyGoal: number
  libraryCount: number

  // 显示设置
  fontSize: string
  onFontSizeChange: (value: string) => void
  bold: boolean
  onBoldChange: (on: boolean) => void
  serif: boolean
  onSerifChange: (on: boolean) => void
  eye: boolean
  onEyeChange: (on: boolean) => void
  /** 顶栏按钮区宽度档位（存在本机；`auto` = 按视窗约 72%，800–1800） */
  toolbarWidth: ToolbarWidth
  onToolbarWidthChange: (v: ToolbarWidth) => void
  /** 顶栏按钮区占几行（存在本机；4 = 每组一行，3 / 2 = 相邻组合并） */
  toolbarRows: ToolbarRowMode
  onToolbarRowsChange: (v: ToolbarRowMode) => void

  // 删除保存
  confirmDelSave: boolean
  onDeleteSave: () => void
}

/** 阅读页顶栏：文章选择 / 保存 / 选词与朗读 / 译文与语言点 / 统计 / 显示设置。 */
export default function ReaderToolbar({
  book,
  editions,
  edition,
  onEditionChange,
  bookKeysCount,
  saved,
  savedGroups,
  shownKeys,
  readDays,
  currentValue,
  onPickArticle,
  hasDoc,
  editing,
  savedId,
  onSave,
  onNewArticle,
  vocabMode,
  onToggleVocab,
  onTranslateAll,
  vocabLevel,
  onVocabLevelChange,
  onAutoVocab,
  translateView,
  onTranslateViewChange,
  autoSpeak,
  onAutoSpeakChange,
  selectedId,
  onSpeakSelected,
  readingAll,
  onToggleReadAll,
  onSpeedRead,
  onOpenIntensive,
  onOpenJournal,
  onOpenGoals,
  ttsState,
  ttsVoice,
  onTtsVoiceChange,
  ttsAccents,
  pregenRunning,
  pregenDone,
  pregenTotal,
  onPregenerate,
  onCancelPregenerate,
  pregenAllCached,
  onEnterEdit,
  draft,
  onCleanupEdit,
  onApplyEdit,
  onCancelEdit,
  vocabSeconds,
  sessionPicked,
  todayPicked,
  streak,
  totalPicked,
  totalSeconds,
  studiedCount,
  dailyGoal,
  libraryCount,
  fontSize,
  onFontSizeChange,
  bold,
  onBoldChange,
  serif,
  onSerifChange,
  eye,
  onEyeChange,
  toolbarWidth,
  onToolbarWidthChange,
  toolbarRows,
  onToolbarRowsChange,
  confirmDelSave,
  onDeleteSave,
}: ReaderToolbarProps) {
  /**
   * 四组控件的内容。分几行由 `planToolbarRows` 决定（用户可选 4 / 3 / 2 行），
   * 这里只负责「每组里有哪些控件、按什么顺序」——换行不改顺序、不改分组。
   */
  const groups: Record<ToolbarGroup, ReactNode> = {
    /* 文章：选 / 存 / 新建 / 删除 / 改正文。每格宽度固定，标题长短不会推挤后面。 */
    doc: (
      <>
        <strong>学吧老哥</strong>
        {book && editions.length > 1 && (
          <select
            className="tb-edition"
            value={edition}
            onChange={(e) => onEditionChange(e.target.value)}
            title="按期次筛选内置文章"
          >
            <option value="全部">全部期次（{bookKeysCount}）</option>
            {editions.map(([label, n]) => (
              <option key={label} value={label}>
                {label}（{n}）
              </option>
            ))}
          </select>
        )}
        {(book || saved.length > 0) && (
          <ArticlePicker
            book={book}
            saved={saved}
            savedGroups={savedGroups}
            builtinKeys={shownKeys}
            readDays={readDays}
            currentValue={currentValue}
            onPick={onPickArticle}
          />
        )}
        <button className="tb-save" onClick={onSave} disabled={!hasDoc} title="把这篇（含粘回的翻译/语法）存到本机，刷新后还在">
          保存这篇
        </button>
        {!editing && (
          <button className="tb-new" onClick={onNewArticle} title="新建 / 导入一篇文章（可多选 .txt / .md）">
            ＋ 新建文章
          </button>
        )}
        {hasDoc && !editing && (
          <button className="tb-edit" onClick={onEnterEdit} title="改正文；完成时重新切句，已粘回的分析按句保留">
            编辑正文
          </button>
        )}
        {savedId && (
          <button
            className={'tb-del' + (confirmDelSave ? ' danger' : '')}
            onClick={onDeleteSave}
            title="从本机删除这篇的保存（两步确认，防误删）"
          >
            {confirmDelSave ? '确认删除保存' : '删除保存'}
          </button>
        )}
      </>
    ),

    /* 视图与朗读设置 */
    view: (
      <>
        {hasDoc && !editing && (
          <button
            className={'tb-vocab' + (vocabMode ? ' primary' : '')}
            onClick={onToggleVocab}
            title="选词模式（W）：默认选单个词；按住 Alt / Ctrl 拖动选词组"
          >
            选词模式{vocabMode ? ' · 开' : ''}
          </button>
        )}
        {hasDoc && !editing && (
          <button className="tb-translate" onClick={onTranslateAll} title="生成按句 id 的全文翻译提示词；粘回「应用结果」后逐句对齐">
            全文翻译
          </button>
        )}
        {hasDoc && !editing && (
          <>
            <select
              className="tb-level"
              value={vocabLevel}
              onChange={(e) => onVocabLevelChange(e.target.value as VocabLevel)}
              title="自动标词的词汇标准"
            >
              <option value="cet4">四级</option>
              <option value="cet6">六级</option>
              <option value="ielts">刚开始学雅思</option>
              <option value="ielts65">雅思 6.5</option>
              <option value="kaoyan">考研</option>
            </select>
            <button className="tb-autovocab" onClick={onAutoVocab} title="按所选词汇标准，让 AI 从全文挑出要查的词（结果进「待选」，可增删后再查词）">
              自动标词
            </button>
          </>
        )}
        {hasDoc && !editing && (
          <select
            className="tb-view"
            value={translateView}
            onChange={(e) => onTranslateViewChange(e.target.value as 'off' | 'below' | 'only')}
            title="译文显示：只看原文 / 原文+译文 / 只看译文"
          >
            <option value="off">只看原文</option>
            <option value="below">原文+译文</option>
            <option value="only">只看译文</option>
          </select>
        )}
        {hasDoc && !editing && (
          <select
            className="tb-voice"
            value={ttsVoice}
            onChange={(e) => onTtsVoiceChange(e.target.value)}
            title="朗读音色（Edge 在线 / Piper 离线）：美式 / 英式 / 澳式 / 印度…；改完下一个朗读即生效"
          >
            {ttsAccents.map((a) => (
              <optgroup key={a.label} label={a.label}>
                {a.voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.name.includes(`（${v.gender}）`) ? '' : `（${v.gender}）`}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
        {hasDoc && !editing && isOfflineTtsVoice(ttsVoice) && (
          <span
            className="muted tb-tts-note"
            title="离线音色没有逐词时间戳：朗读正常，但不能逐词高亮 / 点词跳播"
          >
            无逐词高亮
          </span>
        )}
      </>
    ),

    /* 朗读动作与学习入口 */
    action: (
      <>
        {hasDoc && !editing && (
          <button
            className="tb-speak"
            onClick={onSpeakSelected}
            disabled={!selectedId}
            title={selectedId ? '朗读当前选中句（已缓存则秒播）' : '先点一句，再朗读那句'}
          >
            {ttsState === 'loading' ? '🔊 合成中…' : ttsState === 'playing' ? '🔊 朗读中' : '🔊 读本句'}
          </button>
        )}
        {hasDoc && !editing && (
          <button
            className={'tb-readall' + (readingAll ? ' danger' : '')}
            onClick={onToggleReadAll}
            title="用 TTS 逐句朗读整篇；再点一次停止"
          >
            {readingAll
              ? '⏹ 停止朗读'
              : ttsState === 'loading'
                ? '🔊 准备中…'
                : ttsState === 'playing'
                  ? '🔊 朗读中'
                  : '🔊 朗读全文'}
          </button>
        )}
        {hasDoc && !editing && (
          <button
            className={'tb-pregen' + (pregenRunning ? ' danger' : '')}
            onClick={pregenRunning ? onCancelPregenerate : onPregenerate}
            title={
              pregenRunning
                ? '正在把整篇朗读音频生成并缓存到本机；再点一次取消'
                : pregenAllCached
                  ? '整篇朗读音频都已缓存（点一下可重查）'
                  : '把整篇的朗读音频一次性生成并缓存到本机；之后连播 / 点句起播零延迟'
            }
          >
            {pregenRunning
              ? `⏳ 生成中 ${pregenDone}/${pregenTotal}`
              : pregenAllCached
                ? '✅ 已全部缓存'
                : '⬇ 预生成朗读'}
          </button>
        )}
        {hasDoc && !editing && (
          <button className="tb-speed" onClick={onSpeedRead} title="逐句速读：一次一句，先自己读→空格看释义/语言点；超时算不太理解，来个填空拷打">
            ⚡ 速读
          </button>
        )}
        {hasDoc && !editing && (
          <button
            className="tb-intensive primary"
            onClick={onOpenIntensive}
            title="精读工作流：通读 → 查词 → 词块 → 句子 → 拷打 → 仿写 → 语法，按进度一步步带你做深"
          >
            🎯 精读
          </button>
        )}
        {hasDoc && !editing && (
          <button className="tb-journal" onClick={onOpenJournal} title="学习日志：按天看那天新增了哪些生词/语言点、背过哪些词、练习成绩">
            📅 日志
          </button>
        )}
        <button className="tb-goals" onClick={onOpenGoals} title="目标备忘：今天读完了几篇（可设目标）+ 随手记">
          📌 目标
        </button>
        {editing && (
          <>
            <button className="tb-clean" onClick={onCleanupEdit} disabled={!draft.trim()} title="复制一段提示词：让 AI 去掉这段文本的多余换行、粘连和错误，再把结果贴回编辑框">
              生成清洗提示词
            </button>
            <button className="tb-done primary" onClick={onApplyEdit}>
              完成
            </button>
            <button className="tb-cancel" onClick={onCancelEdit}>
              取消
            </button>
          </>
        )}
      </>
    ),

    /* 计时与统计；「显示」弹层从顶栏右边缘往里开，不会溢出视窗 */
    status: (
      <>
        {vocabMode && (
          <span className="muted timer" title="选词模式计时；今日/连续/累计统计记在本机">
            ⏱ {fmtDur(vocabSeconds)} · 本轮 {sessionPicked} · 今日 {todayPicked} ·🔥{streak} · 累计 {totalPicked} 词 /{' '}
            {fmtDur(totalSeconds)}
          </span>
        )}
        <span className="muted lib-count">{libraryCount} 个生词</span>
        <span className="muted goal-chip" title="今日目标（按学过的不同单词数）；点「统计」可改目标">
          🎯 {studiedCount}
          {dailyGoal > 0 ? `/${dailyGoal}` : ''} · 🔥{streak}
        </span>
        <a className="navlink tb-home" href="./index.html" title="回到跟读练习">
          <span className="arrow">←</span> 跟读练习
        </a>
        <details className="tb-settings">
          <summary title="显示设置">显示 ⚙</summary>
          <div className="tb-settings-body">
            <select
              className="tb-width-select"
              value={toolbarWidth}
              onChange={(e) => onToolbarWidthChange(e.target.value as ToolbarWidth)}
              title="顶栏按钮区的宽度：自适应 = 随视窗约 72%（800–1800）；铺满 = 占满整行"
            >
              {TOOLBAR_WIDTHS.map((w) => (
                <option key={w} value={w}>
                  工具条 {TOOLBAR_WIDTH_LABEL[w]}
                </option>
              ))}
            </select>
            <select
              className="tb-rows-select"
              value={toolbarRows}
              onChange={(e) => onToolbarRowsChange(Number(e.target.value) as ToolbarRowMode)}
              title="顶栏按钮区分几行：4 行最清楚；少一行就少占一条纵向空间（行变宽，窄屏会自动折行）"
            >
              {TOOLBAR_ROW_MODES.map((n) => (
                <option key={n} value={n}>
                  工具条 {TOOLBAR_ROWS_LABEL[n]}
                </option>
              ))}
            </select>
            <select value={fontSize} onChange={(e) => onFontSizeChange(e.target.value)} title="正文字号">
              <option value="sm">字号 小</option>
              <option value="md">字号 中</option>
              <option value="lg">字号 大</option>
              <option value="xl">字号 特大</option>
            </select>
            <label className="check-inline" title="正文加粗">
              <input type="checkbox" checked={bold} onChange={(e) => onBoldChange(e.target.checked)} />
              加粗
            </label>
            <label className="check-inline" title="正文用衬线字体（更像书）">
              <input type="checkbox" checked={serif} onChange={(e) => onSerifChange(e.target.checked)} />
              衬线
            </label>
            <label className="check-inline" title="护眼模式：浅色纸感（浅绿底 + 深色字）">
              <input type="checkbox" checked={eye} onChange={(e) => onEyeChange(e.target.checked)} />
              护眼
            </label>
          </div>
        </details>
        {/* 「选中朗读」跟在「显示 ⚙」右边：它是个开关，和显示设置同属「怎么读/怎么看」，
            放在视图行里会多占一格宽度，挪到这里不挤视图行。 */}
        {hasDoc && !editing && (
          <label className="check-inline tb-autospeak" title="点句子后自动朗读原文">
            <input type="checkbox" checked={autoSpeak} onChange={(e) => onAutoSpeakChange(e.target.checked)} />
            选中朗读
          </label>
        )}
      </>
    ),
  }

  return (
    <div className="bar reader-toolbar">
      {/* 工具条本体：宽度只跟视窗宽度有关（≈72%，800–1800），居中；不铺满整个视窗。
          宽度定死 → 每行按钮的位置就定死，不会随窗口 / 标题 / 文案浮动。 */}
      <div className="tb-inner" style={toolbarWidthStyle(toolbarWidth)}>
        {/* 四组控件的内容见上面的 `groups`；分行按用户选的档位来：
            4 行 = 每组一行，3 行 / 2 行 = 相邻组合并（并出来的行变宽，条子跟着变宽）。 */}
        {planToolbarRows(toolbarRows).map((rowGroups) => (
          <div key={rowGroups.join('-')} className={toolbarRowClass(rowGroups)}>
            {rowGroups.map((group, i) => (
              <Fragment key={group}>
                {i > 0 && <span className="tb-sep" aria-hidden="true" />}
                {groups[group]}
              </Fragment>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
