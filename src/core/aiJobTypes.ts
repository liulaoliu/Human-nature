/**
 * AI 工作包的类型底座：任务清单、任务名、job / result / pack 的结构。
 *
 * 单独一层的理由：包读写（`aiPackIO`）、待办筛选（`aiTodos`）、网页版提示词
 * （`aiWebPack`）都要认这些类型，而它们之间不该互相 import。
 * 这里没有任何业务逻辑，加字段也不会牵动别人。
 */

/** 可以打包的 AI 任务类型（与 ReaderApp 的 lastTask 对齐）。 */
export const AI_JOB_TASKS = [
  'lookup',
  'translate',
  'auto_vocab',
  'confusable',
  'example',
  'phrase',
  'lemma',
  'pos',
  'grammar_mark',
  'listening',
  'language',
  'golden',
  'imitation',
  'feedback',
] as const

export type AiJobTask = (typeof AI_JOB_TASKS)[number]

export function isAiJobTask(value: unknown): value is AiJobTask {
  return typeof value === 'string' && (AI_JOB_TASKS as readonly string[]).includes(value)
}

/** 任务类型的中文名（进度面板分组显示用）。 */
export const AI_TASK_LABEL: Record<AiJobTask, string> = {
  lookup: '查词/补齐',
  translate: '翻译',
  auto_vocab: '自动标词',
  confusable: '混淆项',
  example: '例句',
  phrase: '词组/习语',
  lemma: '原形',
  pos: '-ing/-ed',
  grammar_mark: '语法标记',
  listening: '听力',
  language: '语言点',
  golden: 'D老师小课堂',
  imitation: '仿写',
  feedback: '批改',
}

/** 工作包里的一个待办：一条提示词 + 应用它时需要的上下文（问过哪些词/句）。 */
export interface AiJob {
  id: string
  task: AiJobTask
  /** 人看的一行说明，例如「生成混淆项（60）」。 */
  label: string
  /** 回执里用于判断「AI 没返回哪些」的词。 */
  askedWords: string[]
  /** 同上，句子 id（翻译 / 语言点）。 */
  askedIds: string[]
  /** 要原样发给 AI 的完整提示词。 */
  prompt: string
  /** 这条任务属于哪篇文章（正文签名）；应用前校验，防止切文章后写错。 */
  articleKey?: string
}

export interface AiJobPack {
  version: 1
  exportedAt: string
  /**
   * 给 AI / 本机 agent 的结果格式说明：直接把它当系统提示，就能产出可导入的 results 包。
   * 导出包带上它，agent 就不会只回裸答案（那样导入会报「缺少 results 数组」）。
   */
  instructions?: string
  jobs: AiJob[]
}

/** AI 返回包里的单条结果：按 id 对应一个 job，raw 是 AI 的原始返回文本。 */
export interface AiResultEntry {
  id: string
  /** 可选：id 对不上时兜底用任务类型。 */
  task?: AiJobTask
  /** 可选：id 对不上时兜底用（一般是 job 的 askedWords / askedIds）。 */
  askedWords?: string[]
  askedIds?: string[]
  raw: string
}

export const AI_JOB_PACK_VERSION = 1
