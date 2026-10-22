/**
 * 精读 AI 流程的公共底座：任务类型、各表结构的行类型，以及提示词与解析共用的字符串工具。
 *
 * 为什么单独一层：`build*`（拼提示词）和 `parse*`（解析粘回结果）是两件事，
 * 但都要用 `HEADER`、引号包裹、列表拆分；硬塞在一个文件里会互相牵制，
 * 又不能用「解析依赖提示词」这种假依赖把它们串起来。
 * 这里只放两边都要用、且不依赖任何业务逻辑的东西；对外门面仍是 `analyzer.ts`。
 */

export type AnalysisTask =
  | 'translate'
  | 'lookup'
  | 'grammar'
  | 'collocations'
  | 'extract_vocab'
  | 'summarize'
  | 'auto_vocab'

export interface BuildPromptInput {
  task: AnalysisTask
  /** 选中的原文（句子/段落），作为上下文或翻译对象 */
  text: string
  /** lookup 任务要查的词；不填就用 text 自己 */
  words?: string[]
}

/** 提示词里包裹原文/单词列表的三引号围栏（与正文隔开，避免 AI 把正文当指令）。 */
export const FENCE = '"""'

/** 用围栏包住一段原文，前后各留一个换行。 */
export function quoted(text: string): string {
  return `${FENCE}\n${text.trim()}\n${FENCE}`
}

/** 所有提示词共用的系统口吻。 */
export const HEADER = '你是英语精读助手。只输出结果，不要解释。'

/** 查词表格的字段顺序，解析时按这个顺序取。 */
export const LOOKUP_FIELDS = ['word', 'phonetic', 'partOfSpeech', 'meaning', 'usage', 'example']

/** 把一行里用各种分隔符隔开的条目拆出来（去项目符号/编号，丢空项）。 */
export function splitList(raw: string): string[] {
  return raw
    .split(/[\n;；、]+/)
    .map((s) => s.replace(/^[-*•\d.、\s]+/, '').trim())
    .filter(Boolean)
}

/**
 * 清洗 AI 给的例句：去编号/项目符号、去包裹引号、压缩空白。
 * 句子被 AI 加序号或引号很常见，不清会污染卡片、也影响挖空。
 */
export function cleanExampleText(raw: string): string {
  return raw
    .replace(/^\s*(?:[-*•·]|\d+[.)、])\s*/, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface PhraseRow {
  word: string
  phrases: string[]
  idioms: string[]
}

export interface GrammarMarkRow {
  word: string
  marks: string[]
}

export interface ExampleRow {
  word: string
  examples: { text: string; translation?: string }[]
}

export type VocabLevel = 'cet4' | 'cet6' | 'kaoyan' | 'ielts' | 'ielts65'

export interface ConfusableEntry {
  word: string
  meaning?: string
}

export interface ConfusableResult {
  word: string
  confusables: ConfusableEntry[]
}

export interface LemmaPair {
  from: string
  to: string
}

/** -ing/-ed 语法辨析结果的一行（8 列）。 */
export interface PosRow {
  lemma: string
  surface: string
  pos: string
  syntax: string
  role: string
  meaning: string
  reason: string
  label: string
}
