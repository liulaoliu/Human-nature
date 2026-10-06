import ArticlePicker from '../ArticlePicker'
import type { ArticleBook } from '../../core/matchArticle'
import type { SavedArticle } from '../../adapters/articleRepo'
import type { VocabLevel } from '../../core/analyzer'
import type { TtsAccent } from '../../core/ttsVoices'
import { fmtDur } from '../format'

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
  confirmDelSave,
  onDeleteSave,
}: ReaderToolbarProps) {
  return (
    <div className="bar">
      <strong>学吧老哥</strong>
      {book && editions.length > 1 && (
        <select value={edition} onChange={(e) => onEditionChange(e.target.value)} title="按期次筛选内置文章">
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
          currentValue={currentValue}
          onPick={onPickArticle}
        />
      )}
      <button onClick={onSave} disabled={!hasDoc} title="把这篇（含粘回的翻译/语法）存到本机，刷新后还在">
        保存这篇
      </button>
      {!editing && (
        <button onClick={onNewArticle} title="新建 / 导入一篇文章（可多选 .txt / .md）">
          ＋ 新建文章
        </button>
      )}
      {hasDoc && !editing && (
        <button
          className={vocabMode ? 'primary' : ''}
          onClick={onToggleVocab}
          title="选词模式（W）：默认选单个词；按住 Alt / Ctrl 拖动选词组"
        >
          选词模式{vocabMode ? ' · 开' : ''}
        </button>
      )}
      {hasDoc && !editing && (
        <button onClick={onTranslateAll} title="生成按句 id 的全文翻译提示词；粘回「应用结果」后逐句对齐">
          全文翻译
        </button>
      )}
      {hasDoc && !editing && (
        <>
          <select
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
          <button onClick={onAutoVocab} title="按所选词汇标准，让 AI 从全文挑出要查的词（结果进「待选」，可增删后再查词）">
            自动标词
          </button>
        </>
      )}
      {hasDoc && !editing && (
        <select
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
        <label className="check-inline" title="点句子后自动朗读原文">
          <input type="checkbox" checked={autoSpeak} onChange={(e) => onAutoSpeakChange(e.target.checked)} />
          选中朗读
        </label>
      )}
      {hasDoc && !editing && (
        <select
          value={ttsVoice}
          onChange={(e) => onTtsVoiceChange(e.target.value)}
          title="朗读口音（Edge TTS 音色）：美式 / 英式 / 澳式 / 印度…；改完下一个朗读即生效"
        >
          {ttsAccents.map((a) => (
            <optgroup key={a.label} label={a.label}>
              {a.voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}（{v.gender}）
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
      {hasDoc && !editing && selectedId && (
        <button onClick={onSpeakSelected} title="朗读当前选中句（已缓存则秒播）">
          {ttsState === 'loading' ? '🔊 合成中…' : ttsState === 'playing' ? '🔊 朗读中' : '🔊 读本句'}
        </button>
      )}
      {hasDoc && !editing && (
        <button
          className={readingAll ? 'danger' : ''}
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
          className={pregenRunning ? 'danger' : ''}
          onClick={pregenRunning ? onCancelPregenerate : onPregenerate}
          title="把整篇的朗读音频一次性生成并缓存到本机；之后连播 / 点句起播零延迟"
        >
          {pregenRunning
            ? `⏳ 生成中 ${pregenDone}/${pregenTotal}（点此取消）`
            : pregenAllCached
              ? '✅ 已全部缓存（点此重查）'
              : '⬇ 预生成朗读'}
        </button>
      )}
      {hasDoc && !editing && (
        <button onClick={onEnterEdit} title="改正文；完成时重新切句，已粘回的分析按句保留">
          编辑正文
        </button>
      )}
      {vocabMode && (
        <span className="muted timer" title="选词模式计时；今日/连续/累计统计记在本机">
          ⏱ {fmtDur(vocabSeconds)} · 本轮 {sessionPicked} · 今日 {todayPicked} ·🔥{streak} · 累计 {totalPicked} 词 /{' '}
          {fmtDur(totalSeconds)}
        </span>
      )}
      {editing && (
        <>
          <button onClick={onCleanupEdit} disabled={!draft.trim()} title="复制一段提示词：让 AI 去掉这段文本的多余换行、粘连和错误，再把结果贴回编辑框">
            生成清洗提示词
          </button>
          <button className="primary" onClick={onApplyEdit}>
            完成
          </button>
          <button onClick={onCancelEdit}>取消</button>
        </>
      )}
      {savedId && (
        <button
          className={confirmDelSave ? 'danger' : ''}
          onClick={onDeleteSave}
          title="从本机删除这篇的保存（两步确认，防误删）"
        >
          {confirmDelSave ? '确认删除保存' : '删除保存'}
        </button>
      )}
      <span className="muted">{libraryCount} 个生词</span>
      <span className="muted goal-chip" title="今日目标（按学过的不同单词数）；点「统计」可改目标">
        🎯 {studiedCount}
        {dailyGoal > 0 ? `/${dailyGoal}` : ''} · 🔥{streak}
      </span>
      <details className="tb-settings">
        <summary title="显示设置">显示 ⚙</summary>
        <div className="tb-settings-body">
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
      <a className="navlink" href="./index.html" title="回到跟读练习">
        <span className="arrow">←</span> 跟读练习
      </a>
    </div>
  )
}
