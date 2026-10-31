/**
 * 仿写批改的**错因标签体系**（纯数据 + 纯函数）。
 *
 * 为什么要闭集：全库趋势要回答「我老在句首大写上错」，就不能让 AI 每次
 * 自由写 `Capitalization` / `capital` / `首字母` 三种标签。`rule` 是跨句、
 * 跨篇归一的键；`key` 才是这一条错因（一张复习卡）的具体身份。
 *
 * 本文件不 import 任何运行时模块，Node 回填脚本可以直接 import（带 .ts 后缀），
 * 浏览器侧由 `writing.ts` / `writingErrors.ts` 正常引用。
 */

export const WRITING_ISSUE_TYPES = [
  'spelling',
  'capitalization',
  'punctuation',
  'article',
  'number',
  'collocation',
  'chunk',
  'grammar',
  'naturalness',
  'meaning',
  'other',
] as const

export type WritingIssueType = (typeof WRITING_ISSUE_TYPES)[number]

export const WRITING_TYPE_LABEL: Record<WritingIssueType, string> = {
  spelling: '拼写',
  capitalization: '大小写',
  punctuation: '标点 / 空格',
  article: '冠词',
  number: '单复数',
  collocation: '搭配',
  chunk: '词块',
  grammar: '语法 / 结构',
  naturalness: '中式 / 自然度',
  meaning: '语义 / 逻辑',
  other: '其他',
}

export const WRITING_RULES = [
  'sentence-initial-capital',
  'brand-name-capitalization',
  'capitalization-other',
  'word-spelling',
  'comma-followed-by-space',
  'space-before-punctuation',
  'comma-splice',
  'number-unit-spacing',
  'apostrophe-decade',
  'punctuation-other',
  'article-missing',
  'article-wrong',
  'plural-form',
  'countability',
  'preposition-collocation',
  'verb-pattern',
  'verb-object-collocation',
  'collocation-other',
  'chunk-missing',
  'chunk-form',
  'chunk-sense',
  'incomplete-clause',
  'missing-form-object',
  'tense-choice',
  'subject-verb-agreement',
  'word-order',
  'grammar-other',
  'literal-translation',
  'unnatural-subject',
  'unclear-reference',
  'style-improvement',
  'naturalness-other',
  'prompt-mismatch',
  'logic-contradiction',
  'meaning-other',
  'other',
] as const

export type WritingRule = (typeof WRITING_RULES)[number]

/** rule → type：趋势/颜色/文案只看这一份映射，AI 输出的 type 不单独采信。 */
export const WRITING_RULE_TYPE: Record<WritingRule, WritingIssueType> = {
  'sentence-initial-capital': 'capitalization',
  'brand-name-capitalization': 'capitalization',
  'capitalization-other': 'capitalization',
  'word-spelling': 'spelling',
  'comma-followed-by-space': 'punctuation',
  'space-before-punctuation': 'punctuation',
  'comma-splice': 'punctuation',
  'number-unit-spacing': 'punctuation',
  'apostrophe-decade': 'punctuation',
  'punctuation-other': 'punctuation',
  'article-missing': 'article',
  'article-wrong': 'article',
  'plural-form': 'number',
  countability: 'number',
  'preposition-collocation': 'collocation',
  'verb-pattern': 'collocation',
  'verb-object-collocation': 'collocation',
  'collocation-other': 'collocation',
  'chunk-missing': 'chunk',
  'chunk-form': 'chunk',
  'chunk-sense': 'chunk',
  'incomplete-clause': 'grammar',
  'missing-form-object': 'grammar',
  'tense-choice': 'grammar',
  'subject-verb-agreement': 'grammar',
  'word-order': 'grammar',
  'grammar-other': 'grammar',
  'literal-translation': 'naturalness',
  'unnatural-subject': 'naturalness',
  'unclear-reference': 'naturalness',
  'style-improvement': 'naturalness',
  'naturalness-other': 'naturalness',
  'prompt-mismatch': 'meaning',
  'logic-contradiction': 'meaning',
  'meaning-other': 'meaning',
  other: 'other',
}

export const WRITING_RULE_LABEL: Record<WritingRule, string> = {
  'sentence-initial-capital': '句首首字母未大写',
  'brand-name-capitalization': '品牌 / 专有名词大小写',
  'capitalization-other': '其他大小写问题',
  'word-spelling': '单词拼写',
  'comma-followed-by-space': '逗号后缺空格',
  'space-before-punctuation': '标点前多空格',
  'comma-splice': '逗号粘连（两个独立分句）',
  'number-unit-spacing': '数字与单位之间缺空格',
  'apostrophe-decade': '年代 / 所有格撇号写法',
  'punctuation-other': '其他标点问题',
  'article-missing': '缺冠词',
  'article-wrong': '冠词用错',
  'plural-form': '单复数形式',
  countability: '可数 / 不可数',
  'preposition-collocation': '介词搭配',
  'verb-pattern': '动词句型（to do / doing）',
  'verb-object-collocation': '动宾搭配',
  'collocation-other': '其他固定搭配',
  'chunk-missing': '规定词块没用上',
  'chunk-form': '词块形式不完整',
  'chunk-sense': '词块义项 / 及物性用错',
  'incomplete-clause': '句子不完整 / 从句结构',
  'missing-form-object': '缺形式宾语 / 必要成分',
  'tense-choice': '时态选择',
  'subject-verb-agreement': '主谓一致',
  'word-order': '语序',
  'grammar-other': '其他语法问题',
  'literal-translation': '中式直译',
  'unnatural-subject': '主语 / 搭配不自然',
  'unclear-reference': '指代不清',
  'style-improvement': '更地道的表达（提升项）',
  'naturalness-other': '其他自然度问题',
  'prompt-mismatch': '偏离中文提示 / 场景',
  'logic-contradiction': '语义矛盾 / 逻辑不通',
  'meaning-other': '其他语义问题',
  other: '其他',
}

/** 需要「规则级」复习卡（答案不依赖具体句子）的机械规则。 */
const MECHANICAL_RULES = new Set<WritingRule>([
  'sentence-initial-capital',
  'brand-name-capitalization',
  'capitalization-other',
  'comma-followed-by-space',
  'space-before-punctuation',
  'comma-splice',
  'number-unit-spacing',
  'apostrophe-decade',
  'punctuation-other',
  'article-missing',
  'article-wrong',
  'plural-form',
  'countability',
  'preposition-collocation',
  'verb-pattern',
  'incomplete-clause',
  'missing-form-object',
  'tense-choice',
  'subject-verb-agreement',
  'word-order',
  'grammar-other',
])

export function isWritingRule(value: unknown): value is WritingRule {
  return typeof value === 'string' && (WRITING_RULES as readonly string[]).includes(value)
}

export function writingTypeOf(rule: WritingRule): WritingIssueType {
  return WRITING_RULE_TYPE[rule]
}

/** 稳定 slug：只允许小写字母 / 数字 / 连字符，供 `key` 使用。 */
export function writingKeySlug(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36)
    .replace(/-+$/g, '')
  return s || 'x'
}

/** key 的合法形状：`chunk-an-end-to` / `spelling-bureaucracy`。 */
export function isWritingIssueKey(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{2,40}$/.test(value)
}

/**
 * 给一条错因生成 `key`：
 * - 机械规则（大写 / 标点 / 冠词 / 语法）用规则级 key，避免同一规则堆几十张卡；
 * - 词汇 / 词块 / 搭配 / 语义用「类型 + 改正片段」，保证每个词块有自己的卡。
 */
export function writingKeyFor(
  rule: WritingRule,
  original: string,
  suggestion: string,
): string {
  if (MECHANICAL_RULES.has(rule)) return rule
  const body = writingKeySlug(suggestion || original)
  return `${writingTypeOf(rule)}-${body}`
}

/** 旧版批改（或 AI 漏字段）→ 新标签；只在回填和运行时兜底使用。 */
export interface LegacyIssueLike {
  original?: string
  suggestion?: string
  reason?: string
}

export interface ClassifiedIssue {
  type: WritingIssueType
  rule: WritingRule
  key: string
  severity: 'must-fix' | 'improvement'
}

function looksLikeImprovement(reason: string): boolean {
  if (!reason) return false
  const hard = /错误|不成立|拼写|缺少|缺冠词|未使用|没有用上|未出现|语法|不成句|矛盾|必须|应改为|不能接|不及物|单复数/.test(
    reason,
  )
  if (hard) return false
  return /更地道|更自然|更具体|更准确|更顺|更清晰|更贴合|更正式|可考虑|建议用|建议改为|略显|偏正式|偏中式|润色|提升|不够自然|可改为|可换成|可以更/.test(
    reason,
  )
}

function ruleFromText(original: string, suggestion: string, reason: string): WritingRule {
  const s = `${original} ${suggestion} ${reason}`.toLowerCase()
  if (/拼写|错拼|少了一个字母|漏写|多写|不是英语单词|不成立.*单词/.test(s)) return 'word-spelling'
  if (/首字母|大写|大小写/.test(s)) {
    return /品牌|iphone|ipad|apple|专有名词/.test(s) ? 'brand-name-capitalization' : 'sentence-initial-capital'
  }
  if (/逗号.*空格|空格.*逗号|逗号后|逗号前|逗号粘连|独立分句之间/.test(s)) {
    if (/独立分句|粘连/.test(s)) return 'comma-splice'
    if (/前.*空格|空格.*前/.test(s)) return 'space-before-punctuation'
    return 'comma-followed-by-space'
  }
  if (/撇号|年代|90's|1990s/.test(s)) return 'apostrophe-decade'
  if (/数字.*单位|单位.*空格|\$14|billion/.test(s)) return 'number-unit-spacing'
  if (/标点|引号/.test(s)) return 'punctuation-other'
  if (/冠词|定冠词|不定冠词/.test(s)) return /缺|需要|漏/.test(s) ? 'article-missing' : 'article-wrong'
  if (/单复数|复数形式/.test(s)) return 'plural-form'
  if (/不可数|可数/.test(s)) return 'countability'
  if (/词块|必须使用|未使用|没有用上|未出现|规定词块/.test(s)) {
    if (/未使用|没有用上|未出现|没用上/.test(s)) return 'chunk-missing'
    return /义项|及物|不及物|语义/.test(s) ? 'chunk-sense' : 'chunk-form'
  }
  if (/中式|直译/.test(s)) return 'literal-translation'
  if (/介词/.test(s)) return 'preposition-collocation'
  if (/不定式|to do|doing|动词句型|不能接/.test(s)) return 'verb-pattern'
  if (/搭配/.test(s)) return 'verb-object-collocation'
  if (/不成句|缺主句|句子不完整|从句结构/.test(s)) return 'incomplete-clause'
  if (/形式宾语|缺.*it|必要成分/.test(s)) return 'missing-form-object'
  if (/时态/.test(s)) return 'tense-choice'
  if (/主谓一致/.test(s)) return 'subject-verb-agreement'
  if (/语序/.test(s)) return 'word-order'
  if (/语法|句子结构/.test(s)) return 'grammar-other'
  if (/中式|直译/.test(s)) return 'literal-translation'
  if (/主语/.test(s)) return 'unnatural-subject'
  if (/指代/.test(s)) return 'unclear-reference'
  if (/偏离|中文提示|场景|语境/.test(s)) return 'prompt-mismatch'
  if (/逻辑|矛盾/.test(s)) return 'logic-contradiction'
  if (/不自然|生硬|荒诞|空泛|重复/.test(s)) return 'naturalness-other'
  if (/语义|意思/.test(s)) return 'meaning-other'
  return 'other'
}

/** 旧批改 / AI 漏字段时的启发式兜底；新数据应直接带 rule + key。 */
export function classifyLegacyIssue(issue: LegacyIssueLike): ClassifiedIssue {
  const original = (issue.original ?? '').trim()
  const suggestion = (issue.suggestion ?? '').trim()
  const reason = (issue.reason ?? '').trim()
  const rule = ruleFromText(original, suggestion, reason)
  const type = writingTypeOf(rule)
  const severity =
    rule === 'style-improvement' || (!MECHANICAL_RULES.has(rule) && looksLikeImprovement(reason))
      ? 'improvement'
      : 'must-fix'
  return { type, rule, key: writingKeyFor(rule, original, suggestion), severity }
}

/** 给提示词用的紧凑清单（rule: 中文说明）。 */
export function writingRuleCatalog(): string {
  return WRITING_RULES.map((rule) => `- ${rule}: ${WRITING_RULE_LABEL[rule]}`).join('\n')
}
