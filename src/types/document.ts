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
}

/** 生词来源：标词时自动回填，便于回看与"例句回填"。 */
export interface VocabSource {
  articleId: string
  fileName: string | null
  sentenceId: string | null
  /** 标词时所在的整句原文 */
  sentenceText: string
}

/** 生词状态流转。 */
export type VocabStatus = 'unqueried' | 'queried' | 'edited' | 'mastered'

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
  /** 音标 */
  phonetic: string | null
  /** 词性 */
  partOfSpeech: string | null
  /** 中文含义 */
  meaning: string | null
  /** 用法 / 搭配（v1 的 collocations 并入这里） */
  usage: string[]
  /** 例句 */
  examples: VocabExample[]
  /** 来源 */
  source: VocabSource | null
  /** 状态 */
  status: VocabStatus
  /** 个人笔记 */
  note: string
  /** 标签 */
  tags: string[]
  /** 复习状态 */
  reviewState: ReviewState
  /** ISO 8601 */
  createdAt: string
  /** ISO 8601 */
  updatedAt: string
}

/** 词库。跨文章累积，独立于任何单篇文档。 */
export interface VocabLibrary {
  schemaVersion: number
  items: VocabItem[]
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
