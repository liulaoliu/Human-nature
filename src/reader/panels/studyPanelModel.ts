import type { VocabItem } from '../../types/document'
import type { StudyDeck } from '../../core/entryKind'
import type { DrillReason, ReviewGrade, StudyMode } from '../../core/vocab'
import type { StudyDraft } from '../hooks/useStudyCardEdit'
import type { StudyScope } from '../hooks/useStudyPool'
import type { SpellingRoundMiss, SpellingRoundTest } from '../hooks/useStudySpellingRound'
import type { MeaningReveal } from './StudyDrill'

/** 拼写判错页的数据（与 `useStudySpelling` 的 miss 形状一致）。 */
export interface StudySpellMissView {
  input: string
  word: string
  meaning: string | null
  requeued: boolean
}

/** 本轮队列 / 进度 / 计时：切卡、判分时变。 */
export interface StudyRoundView {
  card: VocabItem | null
  /** 整个词库（「强制锤炼」里「选词义」的干扰项来源）。 */
  items: VocabItem[]
  queueLength: number
  /** 本轮总数（进度分母，开始时冻结；忘记/模糊加练不改动它）。 */
  roundTotal: number
  /** 忘记/模糊触发的加练次数（单独计数，不计入分母）。 */
  extraCount: number
  index: number
  mode: StudyMode
  deck: StudyDeck
  scope: StudyScope
  counts: { know: number; fuzzy: number; forgot: number }
  cardSeconds: number
  liveSeconds: number
  grandSeconds: number
  forgotCount: number
  /** 本轮还能不能点「重练忘记的」（每轮只发起一次；规则在 core/vocab/extra）。 */
  canRetryForgot: boolean
}

/** 设置：用户偶尔改，改完下一轮 / 下一张生效。 */
export interface StudySettingsView {
  spelling: boolean
  newCount: number
  dueCount: number
  newLimit: number
  newToday: number
  /** 学习模式每组多少词（0 = 跟随范围：本篇 = 全部）。 */
  groupSize: number
  drillAfter: number
}

/** 卡面：每次按键 / 翻面都会变。 */
export interface StudyCardUiView {
  revealed: boolean
  checked: boolean
  input: string
}

/** 判分关卡：学习关 / 复习三态 / 锤炼 / 组末拼写。 */
export interface StudyModesView {
  /** 超时未评分 / 重学卡要评分 → 强制锤炼；null = 不锤炼。 */
  drillReason: DrillReason | null
  /** 标过「不认识」的词在复习 / 加练时先选中文释义（规则在 core/vocab/review）。 */
  meaningGate: boolean
  /** 学习模式：这一卡正在过「4 条中文释义」这一关（判完才进单词卡）。 */
  learnPhase: boolean
  /** 学习模式揭示答案后的高亮（正确项浅绿 / 选错项浅红；auto = 停留后自动进卡）。 */
  learnReveal: MeaningReveal | null
  /** 学习模式：这一卡已判过，停在单词卡等「下一词」（不再评分）。 */
  learnGraded: boolean
  /** 复习模式：三键直接可点（看见单词就能判，不用先翻面）。 */
  reviewKeys: boolean
  /** 复习模式：模糊待定中（卡片已摊开，等「下一词」/「记错了」）。 */
  reviewFuzzy: boolean
  /** 复习模式：已判过并停卡（忘记 / 记错了），等「下一词」。 */
  reviewGraded: boolean
  /** 当前卡正在重学（拼错 / 记住过又忘）。 */
  relearning: boolean
  /** 拼写错误的判定提示；非空时只显示这张「判为不认识」的卡。 */
  spellMiss: StudySpellMissView | null
  /** 组末拼写测试（学习模式每组结束）：非空时整页显示它，`card` 已换成测试里的当前词。 */
  roundTest: SpellingRoundTest | null
  roundMiss: SpellingRoundMiss | null
  roundInput: string
  /** 判定提示期间锁住导航（结束 / 上一个 / 下一个）。 */
  navLocked: boolean
}

/** 卡内维护：编辑 / 删除 / 评分提示。 */
export interface StudyEditView {
  editOpen: boolean
  draft: StudyDraft | null
  delArmed: boolean
  gradeInfo: string
}

/** 视图动作：只传函数，不把 hook 再塞进展示层。 */
export interface StudyPanelActions {
  onClose: () => void
  onExam: () => void
  onSwitchMode: (mode: StudyMode) => void
  onSwitchDeck: (deck: StudyDeck) => void
  onSwitchScope: (scope: StudyScope) => void
  onStartArticleAll: () => void
  onNewLimitChange: (n: number) => void
  onDrillAfterChange: (n: number) => void
  onSpellingChange: (on: boolean) => void
  onGroupSizeChange: (n: number) => void
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
  onBack: () => void
  onNext: () => void
  onMarkUnknown: () => void
  onDrillCleared: () => void
  onMeaningCleared: () => void
  onRoundInputChange: (v: string) => void
  onRoundCheck: () => void
  /** 学习模式「看答案」：判不认识并高亮正确项。 */
  onLearnReveal: () => void
  /** 学习模式选了某一项：判定 + 写库（选错会停在高亮页等「继续」）。 */
  onLearnPick: (index: number, correct: boolean) => void
  /** 打断「看答案」的停留，或选错后点「继续」：立刻进单词卡。 */
  onLearnContinue: () => void
  /** 复习模式：三键之一（认识 / 模糊 / 忘记了）。 */
  onReviewAnswer: (grade: ReviewGrade) => void
  /** 复习模式：模糊摊卡后的出口——「下一词」（认下模糊）/「记错了」（改成不认识）。 */
  onReviewChoice: (choice: 'next' | 'missed') => void
  /** 拼错后确认「判为不认识」，继续下一张（这个词已重排到队尾）。 */
  onAckSpellMiss: () => void
  /** 锤炼里拼错：立即判为不认识（不提供第二次输入）。 */
  onSpellMiss: (typed: string) => void
  onRetryForgot: () => void
  onRestart: () => void
}

/**
 * 背单词面板的视图模型（按变化率分组，不是 hook 的返回类型）。
 *
 * 由 `StudyPanelFromModel` 做唯一翻译：hook → 六组；`StudyPanel` 只消费它。
 * 叶子组件继续收显式 props（`StudyCardView` / `StudyActions` / `StudyToolbar`），
 * 所以测试不需要 Provider，也不需要认识 `useStudySession` 的全部 80 个字段。
 */
export interface StudyPanelModel {
  round: StudyRoundView
  settings: StudySettingsView
  cardUi: StudyCardUiView
  modes: StudyModesView
  edit: StudyEditView
  actions: StudyPanelActions
}

/** 测试 / 故事用的平铺形状：只用于构造模型，不参与运行时。 */
export type StudyPanelFlat = StudyRoundView &
  StudySettingsView &
  StudyCardUiView &
  StudyModesView &
  StudyEditView &
  StudyPanelActions
