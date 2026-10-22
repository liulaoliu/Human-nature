/**
 * 中间层数据模型。整个精读/复读/生词功能的唯一真相来源。
 *
 * 约定：
 * - 所有字段都是可序列化的（不含函数 / Map / Set），`JSON.stringify` 无损。
 * - 时间戳统一用秒、保留两位小数；ISO 时间用字符串。
 * - 每次破坏性改动都要升 `schemaVersion` 并写迁移。
 */

/** 文档级元信息。 */
export interface DocumentMeta {
  /** 唯一标识，建议 `issue + slug` */
  id: string
  /** 文章标题 */
  title: string
  /** 期号，如 "2026-09-27" */
  issue: string
  /** 栏目，如 "Leaders" */
  section: string
  /** 来源。v2 以 pdf_extract 为主，人工复制 / OCR 兜底 */
  sourceFormat: 'pdf_extract' | 'manual_copy' | 'screenshot_ocr'
  /**
   * 音频文件名。这是中间层与现有音频模块之间的桥：
   * 现有 App 按音频文件名去 `articles.json` 查正文，导出时靠它配对。
   */
  audioFile: string | null
  /** ISO 8601 */
  createdAt: string
  /** ISO 8601 */
  updatedAt: string
}

/**
 * 句子与音频的对应区间。
 *
 * v2 明确：由 `core/alignText.ts` 的「块级比例摊词 + 手动锚点」**近似投影**得到，
 * 不是强制对齐。`null` 表示未对齐，播放器必须降级为纯文本模式。
 */
export interface AudioSegment {
  /** 起始秒，保留两位小数 */
  start: number
  /** 结束秒，保留两位小数 */
  end: number
}

/** 自研复习状态（与 Anki 并存，Anki 负责每日刷卡，这里负责 App 内排期）。 */
export interface ReviewState {
  /** 难度系数，初始 2.5 */
  ease: number
  /** 下次复习时间，ISO 8601；未排期时为 null */
  due: string | null
  /** 间隔天数 */
  interval: number
  /** 已复习次数 */
  repetitions: number
  /** 出错（评「忘记」）次数。老数据没有，按 0 算 */
  lapses?: number
  /**
   * 重学阶段：>0 表示这个词正在「从零重学」（拼错 / 记住过又忘记）。
   * 1–3，重新连续答对两次后清零；老数据没有，按 0 算。
   */
  relearn?: number
  /**
   * 学习模式里「没看答案就选对中文释义」累计过几次（跨轮 / 跨天 / 换机都要留着）。
   *
   * 为什么单独记：判定规则是「首次选对 = 模糊，第二次起 = 认识」
   * （第一次可能是蒙对的，再选对一次才算真记得）。这个次数必须跟词走、跟备份走，
   * 放在本机偏好里换台机器就丢了，会出现「明明选对过却一直判模糊」。
   * 老数据没有，按 0 算。判为不认识（看答案 / 选错 / 拼错）时归零。
   */
  meaningPasses?: number
}

/** 句子级语言点（AI 结构化分析：结构 / 语法 / idiom / 词组 / 用法）。 */
export interface SentenceLanguage {
  /** 结构分析 */
  structure?: string
  /** 语法要点 */
  grammar?: string
  /** 习语 */
  idioms?: string[]
  /** 词组 / 搭配 */
  phrases?: string[]
  /** 用法说明 */
  usage?: string[]
  /** 来源：AI 生成 / 手动添加（一句可有多条；AI 的只保留一条） */
  source?: 'ai' | 'manual'
  /** 添加/生成时刻（ISO 8601；老数据没有）。用于「哪天加的语言点」 */
  at?: string
}

/** 单个句子，精读与复读的共同最小单元。 */
export interface Sentence {
  /** 如 "s001" */
  id: string
  /** 所属段落 id，如 "p01" */
  paraId: string
  /** 原文，已清理 */
  text: string
  /** 音频区间；未对齐为 null */
  audio: AudioSegment | null
  /** 中文翻译；未查为 null */
  translation: string | null
  /** 长难句结构说明；非长难句为 null */
  grammarNote: string | null
  /** 写作搭配（v1 字段，保留） */
  collocations: string[]
  /** 本句出现的生词词形 */
  vocab: string[]
  /** AI 结构化的语言点（结构/语法/idiom/词组/用法）——旧字段，单条；新数据用 languages */
  language?: SentenceLanguage
  /** 该句的语言点列表（AI 一条 + 手动若干条） */
  languages?: SentenceLanguage[]
  /** 标签，如 ["long_sentence"] */
  tags: string[]
  /** 复习状态 */
  reviewState: ReviewState
}

/** 段落。 */
export interface Paragraph {
  /** 如 "p01" */
  id: string
  /** 该段包含的句子 id，按顺序 */
  sentenceIds: string[]
}

/** 例句来源：来源句 / AI 生成 / 离线例句库（Tatoeba）。 */
export type VocabExampleOrigin = 'article' | 'ai' | 'tatoeba'

/** 生词例句。 */
export interface VocabExample {
  /** 英文例句 */
  text: string
  /** 中文翻译（可选） */
  translation?: string
  /** 来自哪篇文章 */
  articleId?: string
  /** 来自哪个音频文件 */
  fileName?: string
  /** 来自哪个句子 */
  sentenceId?: string
  /** 例句来源（老数据没有 → 当 AI/来源句；用于卡片上区分「AI / 离线」） */
  origin?: VocabExampleOrigin
}

/** 生词来源：标词时自动回填，便于回看与"例句回填"。 */
export interface VocabSource {
  articleId: string
  fileName: string | null
  sentenceId: string | null
  /** 标词时所在的整句原文 */
  sentenceText: string
}

/**
 * 该词在某篇文章里的**出现语境**（一句话 + 可选「此处含义」）。
 * 同一个词在多篇里出现会累积多条 —— 用来回答「B 篇里的 oldword 是什么意思」。
 */
export interface VocabContext {
  articleId: string
  fileName: string | null
  sentenceId: string | null
  sentenceText: string
  /** 在这个语境下的释义（AI 按本篇上下文给的；可能没有） */
  meaning?: string
  /** 记录时刻 ISO */
  at: string
}

/** 生词状态流转。 */
export type VocabStatus = 'unqueried' | 'queried' | 'edited' | 'mastered'

/**
 * 生词「主要释义」的语法标记（受控建议值，按需扩展）：
 *   名词：可数 / 不可数；动词：及物 / 不及物；形容词：可分级 / 不可分级……
 * 兼有的两项都给，如 `['可数', '不可数']`。
 */
export const GRAMMAR_MARKS = [
  '可数',
  '不可数',
  '及物',
  '不及物',
  '可分级',
  '不可分级',
] as const

export type GrammarMark = (typeof GRAMMAR_MARKS)[number]

/** AI 生成的易混项：形近/义近的词与释义（用于选择题干扰项）。 */
export interface VocabConfusable {
  /** 易混的英文词 */
  word: string
  /** 其中文释义（可选） */
  meaning?: string
}

/**
 * 词条类型：普通单词，或从**句子语言点**里自动收藏的 词组 / 习语 / 用法笔记。
 * 老数据的词条没有 `kind`，一律当 `word`。
 */
export type VocabKind = 'word' | 'phrase' | 'idiom' | 'usage'

/**
 * 生词词条，学习层的一等公民。
 *
 * v1 里生词只是 `Sentence.vocab: string[]`（只有词形），无法承载
 * 「单词 / 音标 / 含义 / 用法」的打印需求，所以独立成词条。
 */
export interface VocabItem {
  id: string
  /** 原词形 */
  word: string
  /** 归一化形式，去重用（running / ran → run） */
  lemma: string
  /** 词条类型（缺省 = 普通单词） */
  kind?: VocabKind
  /**
   * 「从哪条语言点收来的」去重标记（词组/习语/用法自动收藏用）。
   * 有了它，就算词典把词形改写了，也不会重复收同一条。
   */
  langPointId?: string
  /** 音标 */
  phonetic: string | null
  /** 词性 */
  partOfSpeech: string | null
  /** 中文含义 */
  meaning: string | null
  /** 主要释义的语法标记（可数/不可数、及物/不及物…；非名词/动词/形容词或未标注为 undefined） */
  grammarMarks?: string[]
  /** 英英释义（学习者词典风格的一句话，可选） */
  definition?: string | null
  /** 核心字段来源（音标 / 词性 / 中文释义 / 英英释义）；旧数据没有，不猜 */
  fieldSources?: VocabFieldSources
  /** 用法 / 搭配说明（v1 的 collocations 并入这里） */
  usage: string[]
  /** 词组 / 搭配，如 run out；run a business（AI 生成，可选；与 usage 分开展示） */
  phrases?: string[]
  /** 习语 / 固定说法，如 run in the family（AI 生成，可选） */
  idioms?: string[]
  /** 例句 */
  examples: VocabExample[]
  /** 来源 */
  source: VocabSource | null
  /** 在哪些文章里、各自什么语境出现过（多义词据此区分） */
  contexts?: VocabContext[]
  /** 状态 */
  status: VocabStatus
  /** 个人笔记 */
  note: string
  /** 标签 */
  tags: string[]
  /**
   * 最近一次 A4 打印的时间（ISO 8601）。
   * 用来避免重复打印：打印后自动写入，整库/本篇都能据此跳过已打印的词。
   * 老数据没有，按「未打印」算。
   */
  lastPrintedAt?: string | null
  /** 易混项（形近/义近）；选择题干扰项优先用它 */
  confusables?: VocabConfusable[]
  /** 易混项来源；旧数据没有，界面不标注具体来源 */
  confusablesSource?: VocabConfusableSource
  /**
   * 优先重排到期时间（ISO 8601）。答错后写入「次日」，
   * 到期重练时把它排到队列最前（"今日鞭打、次日优先重练"）。
   */
  priorityUntil?: string | null
  /** 复习状态 */
  reviewState: ReviewState
  /** ISO 8601 */
  createdAt: string
  /** ISO 8601 */
  updatedAt: string
}

/** 这个词是通过自动标词还是手动加入收进本篇的。 */
export type VocabOrigin = 'auto' | 'manual'

/**
 * 更细的来源：自动 / 手动只是「谁触发」，这里记录「从哪来」。
 * 旧数据没有这个字段；`batch` / `legacy` 是迁移时兜底，不假装知道具体来源。
 */
export type VocabVia = 'ai' | 'dict' | 'manual' | 'language' | 'auto' | 'batch' | 'legacy'

/** 本篇语境释义的来源（界面可据此标注，AI 结果不覆盖手改）。 */
export type VocabMeaningSource = 'manual' | 'context' | 'library' | 'dict' | 'ai'

/** 易混项来源：AI 生成 / 离线词典拼写近邻；旧数据没有这个字段，不猜。 */
export type VocabConfusableSource = 'ai' | 'dict'

/** 可能被 AI / 离线词典 / 手动同时写入的核心字段。 */
export type VocabField = 'phonetic' | 'partOfSpeech' | 'meaning' | 'definition'

/** 核心字段来源；旧数据没有记录时为 undefined，不猜。 */
export type VocabFieldSource = 'ai' | 'dict' | 'manual'

export type VocabFieldSources = Partial<Record<VocabField, VocabFieldSource>>

/**
 * 「这篇文章收了这个词」的独立记录。
 *
 * 全库 `VocabItem` 按 lemma 只有一条（复习一次），但同一词可以在多篇里各收一次：
 * 每篇的序号、加入方式、语境释义、打印状态都互不影响。
 */
export interface ArticleVocabEntry {
  /** 文章稳定标识（与 `source.fileName` / `articleIdentity` 同一套） */
  articleId: string
  /** 词条原形（对应 `VocabItem.lemma`） */
  lemma: string
  /** 自动标词 / 手动加入 */
  origin: VocabOrigin
  /** 细分来源：AI / 离线词典 / 手动 / 语言点 / 旧数据兜底 */
  via?: VocabVia
  /** 加入时间 ISO（合并备份时排序用；篇内编号按数组顺序） */
  addedAt: string
  /** 收录时所在的句子（速读「本句已收录」/语境释义用） */
  sentenceId?: string | null
  sentenceText?: string
  /** 这一篇里该词的语境释义（可选；没有就回退到全库主释义） */
  meaning?: string | null
  meaningSource?: VocabMeaningSource
  /** 这一篇打印过该词的时间（按篇独立） */
  printedAt?: string | null
}

/** 词库。跨文章累积，独立于任何单篇文档。 */
export interface VocabLibrary {
  schemaVersion: number
  items: VocabItem[]
  /** 按篇收录表；老数据没有该字段，迁移时从来源/语境补出来 */
  articleEntries?: ArticleVocabEntry[]
}

/**
 * 已保存的文章。
 *
 * 为什么要存整篇（而不是只存原文、每次重新切句）：
 * 粘回来的翻译/语法/搭配是挂在句子上的，重新切句会丢。所以连 paragraphs /
 * sentences 一起存，下次打开是你上次离开时的样子。
 */
/** 已保存文章从哪来；旧数据没有这个字段，一律当未知，不按 sourceKey 反推。 */
export type ArticleOrigin = 'library' | 'paste' | 'epub' | 'file'

export interface SavedArticle {
  id: string
  title: string
  /** 所属的书（EPUB 导入自动填书名；手动可选） */
  book?: string
  /** 对应 articles.json 的键；手动粘贴的为 null */
  sourceKey: string | null
  /** 导入来源；旧数据没有就不显示，不猜 */
  origin?: ArticleOrigin
  /** 清洗后的正文；编辑模式与重新切句用 */
  text: string
  paragraphs: Paragraph[]
  sentences: Sentence[]
  /** 首次创建时间（老数据没有 → 用 updatedAt 兜底） */
  createdAt?: string
  updatedAt: string
}

/**
 * 精读结果。一键提示词的「粘回解析」和（以后可选的）API 共用这一结构，
 * 所以现在只实现粘贴解析，以后接 API 也不用改数据模型。
 */
export interface SentenceAnalysis {
  sentenceId: string
  translation?: string
  grammarNote?: string | null
  collocations?: string[]
  vocab?: string[]
}

export interface WordAnalysis {
  word: string
  phonetic?: string
  partOfSpeech?: string
  meaning?: string
  /** 英英释义（学习者词典风格的一句话，可选） */
  definition?: string
  usage?: string[]
  examples?: { text: string; translation?: string }[]
}

export interface AnalysisResult {
  sentences?: SentenceAnalysis[]
  words?: WordAnalysis[]
}

/** 文档根对象。这是导出给外部音频模块的标准结构。 */
export interface EconomistDocument {
  schemaVersion: number
  meta: DocumentMeta
  paragraphs: Paragraph[]
  sentences: Sentence[]
}

/** 当前 schema 版本。破坏性改动 +1。 */
export const SCHEMA_VERSION = 1

/** 新词条的默认复习状态。 */
export function defaultReviewState(): ReviewState {
  return { ease: 2.5, due: null, interval: 0, repetitions: 0 }
}
