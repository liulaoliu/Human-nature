import type { AnalysisResult, Sentence, SentenceAnalysis, WordAnalysis } from '../types/document'

/**
 * 精读模块：一键提示词生成 + 粘回解析。
 *
 * 不默认直连 API（浏览器里放密钥会泄露）。流程是：
 *   选中文字 → buildPrompt() 生成提示词 → 复制到网页版 DeepSeek
 *   → 把返回文本贴回来 → parseAnalysis() / applyToSentence() 落到数据上。
 *
 * 解析结果用统一的 AnalysisResult，将来接 API 也不用改模型。
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

const FENCE = '"""'

function quoted(text: string): string {
  return `${FENCE}\n${text.trim()}\n${FENCE}`
}

const HEADER = '你是英语精读助手。只输出结果，不要解释。'

/** 查词表格的字段顺序，解析时按这个顺序取。 */
export const LOOKUP_FIELDS = ['word', 'phonetic', 'partOfSpeech', 'meaning', 'usage', 'example']

/** 生成可直接粘贴到网页版 DeepSeek 的提示词。 */
export function buildPrompt(input: BuildPromptInput): string {
  const text = input.text.trim()
  switch (input.task) {
    case 'translate':
      return `${HEADER}\n把下面的英文翻译成地道、通顺的中文，只输出译文。\n原文：\n${quoted(text)}`
    case 'grammar':
      return `${HEADER}\n分析下面句子的结构：先给主干，再列修饰成分，再标出从句类型，最后点出难点。只输出分析，不要翻译。\n句子：\n${quoted(text)}`
    case 'collocations':
      return `${HEADER}\n从下面句子里挑出值得学习的动词搭配、介词搭配和地道表达，每条一行，用「 — 」分隔搭配和中文意思。只输出列表。\n句子：\n${quoted(text)}`
    case 'summarize':
      return `${HEADER}\n用中文总结下面这段的要点，最多 3 条，每条一行。只输出总结。\n段落：\n${quoted(text)}`
    case 'extract_vocab':
      return `${HEADER}\n从下面段落里提取超出四六级/雅思范围的高频生词，只输出词形，用逗号分隔，不要重复，不要解释。\n段落：\n${quoted(text)}`
    case 'auto_vocab':
      return buildAutoVocabPrompt(text)
    case 'lookup': {
      const words = (input.words?.length ? input.words : [text]).join(', ')
      return `${HEADER}\n请对下面每个单词输出一行，字段用 | 分隔，顺序固定：\n单词 | 音标 | 词性 | 中文含义 | 用法/搭配 | 例句(英+中)\n单词列一律输出**合适的原形**：名词用单数（companies→company），动词用一般现在时原形（running→run、went→go、Bahrainis→Bahraini），形容词/副词用原级（better→good）。现在分词（-ing）和过去分词（-ed）一律先判断它在上下文里是不是动词用法：只要是动词用法（含作定语但表示动作、构成进行时、构成分词短语等），一律还原为动词原形（dulling→dull、tinkering→tinker、swelling→swell、expunging→expunge）；只有已固化为独立形容词的分词才保持原样（exciting、interesting、expected、complicated、advanced），**不要因为 -ing 形式就默认它是形容词**；独立名词（savings、belongings）保持；音标必须给国际音标（IPA，用斜杠包住，如 /ˈrʌnɪŋ/，按原形给），每个词都要有；词性用 v./n./adj./prep. 等缩写；用法有多条用「；」分隔；例句里英文和中文用「 — 」分隔；确实没把握的才留空，不要编造。\n示例：\nrunning | /rʌn/ | v. | 跑步 | run out；run a business | I run every day. — 我每天跑步。\n单词：${words}\n上下文（帮助判断词义）：\n${quoted(text)}`
    }
  }
}

/** 把一行里用各种分隔符隔开的条目拆出来。 */
function splitList(raw: string): string[] {
  return raw
    .split(/[\n;；、]+/)
    .map((s) => s.replace(/^[-*•\d.、\s]+/, '').trim())
    .filter(Boolean)
}

/** 提取词形列表：逗号/顿号/换行都能拆，去重。 */
export function parseWordList(raw: string): string[] {
  const out: string[] = []
  for (const part of raw.split(/[,，、;；\n]+/)) {
    const w = part.replace(/^[\s\-*•\d.]+/, '').replace(/[.。!！?？"“”]+$/, '').trim()
    if (w && !out.includes(w)) out.push(w)
  }
  return out
}

function parseExample(raw: string): { text: string; translation?: string } {
  const parts = raw.split(/\s+[—–-]\s+/)
  if (parts.length >= 2) {
    return { text: parts[0].trim(), translation: parts.slice(1).join(' — ').trim() }
  }
  return { text: raw.trim() }
}

const HEADER_WORDS = ['单词', 'word', 'phonetic', '音标']

/** 解析查词表格（`word | phonetic | pos | meaning | usage | example`）。 */
export function parseLookupTable(raw: string): WordAnalysis[] {
  const words: WordAnalysis[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || /^[|\-\s:]+$/.test(trimmed)) continue
    const low = trimmed.toLowerCase()
    if (HEADER_WORDS.some((h) => low.includes(h))) continue
    const hadLead = /^[|｜]/.test(trimmed)
    const hadTrail = /[|｜]$/.test(trimmed)
    const cols = trimmed.split(/[|｜]/).map((c) => c.trim())
    // Markdown 表格「前后带竖线」时，各去掉首/尾那一个空列（中间的空字段保留）
    if (hadLead && cols[0] === '') cols.shift()
    if (hadTrail && cols[cols.length - 1] === '') cols.pop()
    if (cols.length < 2) continue
    let [word, phonetic, partOfSpeech, meaning, usage, example] = cols
    if (!word) continue
    // 只有音标格为空时，才从单词格里拆音标（"run /rʌn/" 或 "run [rʌn]"），避免误伤
    if (!phonetic) {
      const m = word.match(/^(.+?)\s+(\/.+)$/) ?? word.match(/^(.+?)\s+(\[.+\])$/)
      if (m) {
        word = m[1].trim()
        phonetic = m[2].trim()
      }
    }
    words.push({
      word,
      phonetic: phonetic || undefined,
      partOfSpeech: partOfSpeech || undefined,
      meaning: meaning || undefined,
      usage: usage ? splitList(usage) : undefined,
      examples: example ? [parseExample(example)] : undefined,
    })
  }
  return words
}

function normalizeJson(value: unknown): AnalysisResult {
  if (Array.isArray(value)) {
    const words = value.filter((v): v is WordAnalysis => !!v && typeof v === 'object' && 'word' in v)
    const sents = value.filter(
      (v): v is { sentenceId?: string; id?: string; translation?: string } =>
        !!v && typeof v === 'object' && ('sentenceId' in v || ('id' in v && 'translation' in v)),
    )
    if (sents.length) {
      return {
        sentences: sents.map((s) => ({ sentenceId: s.sentenceId ?? s.id ?? '', translation: s.translation })),
      }
    }
    return { words }
  }
  if (value && typeof value === 'object') {
    const obj = value as { words?: unknown; sentences?: unknown; word?: unknown }
    if (obj.word) return { words: [obj as WordAnalysis] }
    const out: AnalysisResult = {}
    if (Array.isArray(obj.words)) out.words = obj.words as WordAnalysis[]
    if (Array.isArray(obj.sentences)) out.sentences = obj.sentences as AnalysisResult['sentences']
    return out
  }
  return {}
}

/** 解析粘回来的结果：先试 JSON，再试查词表格，都不中返回空。 */
export function parseAnalysis(raw: string): AnalysisResult {
  const text = raw.trim()
  if (!text) return {}
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      return normalizeJson(JSON.parse(text))
    } catch {
      // 落到表格解析
    }
  }
  const sentences = parseTranslationTable(text)
  if (sentences.length) return { sentences }
  const words = parseLookupTable(text)
  if (words.length) return { words }
  return {}
}

/** 把自由文本结果落到某一句上（翻译 / 语法 / 搭配 / 生词）。 */
export function applyToSentence(sentence: Sentence, task: AnalysisTask, raw: string): Sentence {
  const text = raw.trim()
  if (!text) return sentence
  if (task === 'translate') return { ...sentence, translation: text }
  if (task === 'grammar') return { ...sentence, grammarNote: text }
  if (task === 'collocations') {
    return { ...sentence, collocations: [...new Set([...sentence.collocations, ...splitList(text)])] }
  }
  if (task === 'extract_vocab') {
    return { ...sentence, vocab: [...new Set([...sentence.vocab, ...parseWordList(text)])] }
  }
  return sentence
}

/**
 * 批量查词提示词：一次把多个生词（各自带上下文句）交给 DeepSeek。
 * 用在「选词模式」里攒了一批词，一键复制。
 */
export function buildBatchLookupPrompt(entries: { word: string; context?: string }[]): string {
  const seen = new Set<string>()
  const unique = entries.filter((e) => {
    const k = e.word.trim().toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  const lines = unique
    .map((e) => (e.context ? `- ${e.word}  （上下文：${e.context}）` : `- ${e.word}`))
    .join('\n')
  return `${HEADER}\n请对下面每个单词输出一行，字段用 | 分隔，顺序固定：\n单词 | 音标 | 词性 | 中文含义 | 用法/搭配 | 例句(英+中)\n单词列一律输出**合适的原形**：名词用单数（companies→company），动词用一般现在时原形（running→run、went→go、Bahrainis→Bahraini），形容词/副词用原级（better→good）。现在分词（-ing）和过去分词（-ed）一律先判断它在上下文里是不是动词用法：只要是动词用法（含作定语但表示动作、构成进行时、构成分词短语等），一律还原为动词原形（dulling→dull、tinkering→tinker、swelling→swell、expunging→expunge）；只有已固化为独立形容词的分词才保持原样（exciting、interesting、expected、complicated、advanced），**不要因为 -ing 形式就默认它是形容词**；独立名词（savings、belongings）保持；音标必须给国际音标（IPA，用斜杠包住，如 /rʌn/，按原形给），每个词都要有；词性用 v./n./adj./prep. 等缩写；用法有多条用「；」分隔；例句里英文和中文用「 — 」分隔；确实没把握的才留空，不要编造。\n示例：\nrunning | /rʌn/ | v. | 跑步 | run out；run a business | I run every day. — 我每天跑步。\n单词与上下文：\n${lines}`
}

/**
 * 清洗提示词：把从 PDF / 网页复制来的原始文本交给 AI，去掉多余换行与粘连、修错。
 * 用「新建文章」里的一键复制，粘到网页版 AI，再把结果贴回来。
 */
export function buildCleanupPrompt(raw: string): string {
  return `下面是我从 PDF / 网页复制来的英文文本，可能存在：
- 不该有的换行（一句话被硬拆成好几行）
- 单词粘连（例如 offthe、BarackObama、tookpart）
- 拼写、标点等明显错误

请去掉不必要的换行、修复粘连和错误，保持原意和原有措辞，给我修复后的文本。只输出修复后的文本，不要解释，不要加标题。

原文：
${FENCE}
${raw.trim()}
${FENCE}`
}

/** 解析「id | 译文」逐句翻译表。 */
export function parseTranslationTable(raw: string): SentenceAnalysis[] {
  const out: SentenceAnalysis[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || /^[|\-\s:]+$/.test(t)) continue
    const i = t.search(/[|｜]/)
    if (i < 0) continue
    const id = t.slice(0, i).replace(/[`*\s]/g, '')
    const translation = t.slice(i + 1).replace(/^[|｜\s]+/, '').trim()
    if (/^s\d+$/i.test(id) && translation) out.push({ sentenceId: id, translation })
  }
  return out
}

/**
 * 全文翻译提示词：按句子 id 逐句翻译，id 原样返回，位置天然对齐。
 */
export function buildTranslateAllPrompt(sentences: { id: string; text: string }[]): string {
  const list = sentences.map((s) => `${s.id} | ${s.text}`).join('\n')
  return `${HEADER}\n下面是按顺序编号的英文句子。请逐句翻译成地道、通顺的中文，**每个 id 输出一行**，格式固定：\nid | 中文翻译\n要求：id 原样照抄、顺序不变、不合并也不拆分句子；只输出这些行，不要解释、不要加标题。\n${list}`
}

export type VocabLevel = 'cet4' | 'cet6' | 'kaoyan' | 'ielts' | 'ielts65'

const LEVEL_DESC: Record<VocabLevel, string> = {
  cet4: '以「大学英语四级」为基准（四级大纲以内的词不要）',
  cet6: '以「大学英语六级」为基准（六级大纲以内的词不要）',
  kaoyan: '以「考研英语」大纲为基准',
  ielts: '以「刚开始学雅思」为基准（约雅思 5.5–6 分，核心词汇约 6000）',
  ielts65: '以「雅思 6.5 分」为基准（核心词汇约 8000）',
}

/**
 * 自动标词提示词：让 AI 按指定词汇水平，从文章里挑出值得查词学习的单词。
 * 结果是一串「原形」单词，粘回后进入「待选」清单，人工增删后再查词。
 */
export function buildAutoVocabPrompt(text: string, level: VocabLevel = 'cet6'): string {
  return `${HEADER}\n请${LEVEL_DESC[level]}，从下面这篇文章里挑出**超出该水平、值得查词学习**的单词。\n要求：\n- 每个词输出**原形**：名词用单数、动词用一般现在时（如 running→run、went→go）；\n- 去掉重复；只输出**单个单词**，不要短语、不要编号、不要解释、不要分点，用换行分隔；\n- 数量按文章长度取 15–40 个，按在文中出现的先后顺序。\n文章：\n${quoted(text)}`
}

export interface ConfusableEntry {
  word: string
  meaning?: string
}

export interface ConfusableResult {
  word: string
  confusables: ConfusableEntry[]
}

/**
 * 混淆项提示词：为一批词生成**形近/音近但含义明显不同**的干扰词及释义。
 * 用于给「看词选义 / 词形辨析」提供更贴合的干扰项（生词本太小时尤其有用）。
 *
 * 明确排除「义近词」：否则中文释义会出现近义词，选择题就有多个正确答案。
 */
export function buildConfusablePrompt(entries: { word: string; meaning?: string | null }[]): string {
  const lines = entries.map((e) => (e.meaning ? `- ${e.word}（${e.meaning}）` : `- ${e.word}`)).join('\n')
  return [
    HEADER,
    '下面每个英文单词，请给出 3 个**容易混淆**的英文单词，并给出它们各自的中文释义。',
    '「容易混淆」指：拼写形近、或读音相近、或词形相似——但**含义必须明显不同**。',
    '',
    '务必遵守：',
    '- 干扰词的释义**绝不能**是原词含义的同义词 / 近义词，也不能是原词意思的另一种说法（否则做选择题会出现多个正确答案）。',
    '- 3 个干扰词的释义之间也要**互不相同、区分度高**（不要出现「微调」「微调，调整」这种几乎同义的）。',
    '- 释义要**简短、单一**（一个义项即可），不要用逗号罗列多个近义说法。',
    '- 必须是真实存在的英语单词，且不是原词本身。',
    '',
    '每个词输出一行，格式固定：',
    '原词 | 易混词1:释义1 ; 易混词2:释义2 ; 易混词3:释义3',
    '',
    '示例：',
    'adapt | adopt:收养 ; adept:熟练的 ; adrift:漂浮的',
    '（反例：adapt | adjust:调整 —— adjust 与 adapt 含义太近，不要这样）',
    '',
    '单词：',
    lines,
  ].join('\n')
}

/** 解析混淆项结果（`原词 | 词:释义 ; 词:释义`）。 */
export function parseConfusables(raw: string): ConfusableResult[] {
  const out: ConfusableResult[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim().replace(/^[-*•\d.、\s]+/, '')
    if (!t) continue
    const i = t.search(/[|｜]/)
    if (i < 0) continue
    const word = t.slice(0, i).trim()
    if (!word || /原词|易混|单词|word/i.test(word)) continue
    const confusables: ConfusableEntry[] = []
    for (const part of t.slice(i + 1).split(/[;；]/)) {
      const p = part.trim()
      if (!p) continue
      const m = p.match(/^(.+?)\s*[:：]\s*(.+)$/)
      if (m) confusables.push({ word: m[1].trim(), meaning: m[2].trim() })
      else confusables.push({ word: p })
    }
    if (confusables.length) out.push({ word, confusables })
  }
  return out
}

export interface LemmaPair {
  from: string
  to: string
}

/**
 * 原形校正提示词：给一批词（带来源句语境），让 AI 判断它们在词典里的**原形**。
 * 专治「非原型」词条（saw→see、companies→company、analyses→analysis）。
 */
export function buildLemmaPrompt(entries: { word: string; context?: string }[]): string {
  const lines = entries.map((e) => (e.context ? `- ${e.word}  （语境：${e.context}）` : `- ${e.word}`)).join('\n')
  return [
    HEADER,
    '下面每个英文单词，请根据它出现的语境，判断它在词典里的**原形（lemma）**并输出。',
    '规则：',
    '- 动词一律还原为不定式（saw→see、went→go、running→run）；',
    '- 名词还原为单数（companies→company、analyses→analysis、children→child）；',
    '- 形容词 / 副词还原为原级（better→good、worse→bad）；',
    '- 注意区分同形不同词：saw（看见→see / 锯子→saw）、found（找到→find / 创建→found）、left（离开→leave / 左边→left），按**语境**判断；',
    '- 已经是原形就原样返回。',
    '',
    '每个词输出一行，格式固定：',
    '原词形 | 原形',
    '只输出这些行，不要解释、不要标题、不要编号。',
    '',
    '单词与语境：',
    lines,
  ].join('\n')
}

/** 解析「原词形 | 原形」表。 */
export function parseLemmaTable(raw: string): LemmaPair[] {
  const out: LemmaPair[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim().replace(/^[-*•\d.、\s]+/, '')
    if (!t) continue
    const i = t.search(/[|｜]/)
    if (i < 0) continue
    const from = t.slice(0, i).trim()
    if (!from || /原词形|原形|单词|word/i.test(from)) continue
    const to = t.slice(i + 1).replace(/^[|｜\s]+/, '').trim().split(/[\s（(,，;；]/)[0]
    if (!to) continue
    out.push({ from, to })
  }
  return out
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

/**
 * -ing / -ed 语法辨析提示词：强制逐个判断 -ing/-ed 形式在当前语境里的语法身份，
 * 不许用「可以理解为…/相当于…」含糊带过。
 */
export function buildPosPrompt(entries: { word: string; context?: string }[]): string {
  const lines = entries.map((e) => (e.context ? `- ${e.word}  （语境：${e.context}）` : `- ${e.word}`)).join('\n')
  return [
    HEADER,
    '请针对下面每个单词 / 短语里的 **-ing 或 -ed 形式**，明确判断它在当前语境中具体属于哪一类，',
    '不要只说「可以理解为……」或「相当于……」。逐个按以下要求分析：',
    '1. 先给出它在词典里的原形（lemma）。',
    '2. 明确它的语法身份，必须从下列类别中选一个并说明理由：',
    '   - 谓语动词',
    '   - 非谓语动词（不定式 / 动名词 / 现在分词 / 过去分词）',
    '   - 分词构成的独立形容词',
    '   - 已经固化为独立形容词的分词',
    '   - 名词',
    '   - 其他（请具体说明）',
    '3. 说明它在当前语境中的具体含义（不要只给词典义）。',
    '4. 说明它修饰哪个词，或在句中充当什么成分（主语 / 定语 / 状语 / 补语等）。',
    '5. 如果属于「分词作定语」，必须进一步说明：现在分词还是过去分词、主动还是被动、进行还是完成、相当于哪个定语从句。',
    '6. 如果它已固化为独立形容词，必须给出证据或常见词典标注，不能仅凭 -ing/-ed 形式就判定为形容词。',
    '最后用一句话总结最准确的词性标注。',
    '',
    '输出格式固定（每行一条，字段用 | 分隔，共 8 列）：',
    '原形 | 当前形式 | 当前词性 | 语法身份 | 修饰对象/句子成分 | 具体含义 | 判断理由 | 最准确词性标注',
    '示例：',
    'slide | sliding | adj. | 现在分词转化来的形容词，作定语 | 修饰 oil prices | 持续下跌的 | 表示主动、进行中的状态，相当于 oil prices that are sliding | adj.（分词形容词）',
    '只输出这些行，不要解释、不要标题、不要编号。',
    '',
    '单词与语境：',
    lines,
  ].join('\n')
}

/** 解析 -ing/-ed 辨析表（8 列）。 */
export function parsePosTable(raw: string): PosRow[] {
  const out: PosRow[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim().replace(/^[-*•\d.、\s]+/, '')
    if (!t) continue
    const cols = t.split(/[|｜]/).map((c) => c.trim())
    if (cols.length < 8) continue
    const [lemma, surface, pos, syntax, role, meaning, reason, label] = cols
    if (!lemma || !surface) continue
    if (/原形|当前形式|lemma/i.test(lemma)) continue
    out.push({ lemma, surface, pos, syntax, role, meaning, reason, label })
  }
  return out
}
