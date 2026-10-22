import type { AnalysisResult, Sentence, SentenceAnalysis, WordAnalysis } from '../types/document'
import { GRAMMAR_MARKS } from '../types/document'
import { lemmaOf } from './vocab'
import { wordSpans } from './wordSelect'
import {
  cleanExampleText,
  splitList,
  type AnalysisTask,
  type ConfusableEntry,
  type ConfusableResult,
  type ExampleRow,
  type GrammarMarkRow,
  type LemmaPair,
  type PhraseRow,
  type PosRow,
} from './analyzerShared'

/**
 * 精读 AI 结果解析：把用户从网页版 DeepSeek 粘回来的自由文本，解析成结构化数据。
 *
 * 这里是「输入侧」——只认文本、只出数据，不发请求、不拼提示词（那在 `analyzerPrompt.ts`）。
 * 所有解析器都对脏输入宽容：表头行、分隔线、项目符号、多余竖线都吃掉，认不出就返回空。
 */

/**
 * 把 AI 返回的一个「词条行」清成单词：去编号 / 项目符号、去 markdown、
 * 去掉后面粘的注释（词性、中文、括号说明），只保留开头的英文词。
 * 例：`1. **impeachment (n.)** — 弹劾` → `impeachment`。
 */
export function cleanVocabWord(raw: string): string {
  let w = raw.replace(/[*_`]/g, '').trim()
  w = w.replace(/^[-–•·\s]*\d+\s*[).、]?\s*/, '') // 1. / 1) / 1、
  w = w.replace(/^[-–•·\s]+/, '')
  w = w.split(/[\s—–:：,，;；(（\[【"“”|/]+/)[0] ?? '' // 取第一个 token
  w = w.replace(/[^A-Za-z'\-].*$/u, '')
  return w.trim()
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
    return { text: cleanExampleText(parts[0]), translation: cleanExampleText(parts.slice(1).join(' — ')) }
  }
  return { text: cleanExampleText(raw) }
}

/** 表头判定：只看「首列 / 音标列」是不是表头标签，避免把正文里含 "word" 的正常行误删。 */
const HEADER_FIRST = new Set(['单词', '词语', '原形', '单词/原形'])
const HEADER_PHONETIC = new Set(['音标', '国际音标', 'phonetic', 'ipa'])

/** 解析查词表格（`word | phonetic | pos | meaning | usage | example`）。 */
export function parseLookupTable(raw: string): WordAnalysis[] {
  const words: WordAnalysis[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || /^[|\-\s:]+$/.test(trimmed)) continue
    const hadLead = /^[|｜]/.test(trimmed)
    const hadTrail = /[|｜]$/.test(trimmed)
    const cols = trimmed.split(/[|｜]/).map((c) => c.trim())
    // Markdown 表格「前后带竖线」时，各去掉首/尾那一个空列（中间的空字段保留）
    if (hadLead && cols[0] === '') cols.shift()
    if (hadTrail && cols[cols.length - 1] === '') cols.pop()
    if (cols.length < 2) continue
    // 表头行：音标列写着「音标/phonetic」，或首列是「单词」这类标签。
    // 注意不能全文匹配 "word"——否则像 portmanteau 的释义 "a word formed by…" 会被误当表头。
    const c0 = (cols[0] ?? '').toLowerCase()
    const c1 = (cols[1] ?? '').toLowerCase()
    if (HEADER_PHONETIC.has(c1) || HEADER_FIRST.has(c0)) continue
    let [word, phonetic, partOfSpeech, meaning, usage, example, definition] = cols
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
      definition: definition || undefined,
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

/** 例句是否**真的含该词**（词形还原后比较）；用来剔掉「用同义词糊弄」的例句。 */
function exampleHasWord(text: string, word: string): boolean {
  const lemma = lemmaOf(word)
  const w = word.trim().toLowerCase()
  if (!w) return true
  return wordSpans(text).some((s) => {
    const t = s.text.toLowerCase()
    return t === w || (!!lemma && lemmaOf(s.text) === lemma)
  })
}

/** 解析词组 / 习语表（`单词 | 词组1；词组2 | 习语1；习语2`）。 */
export function parsePhraseTable(raw: string): PhraseRow[] {
  const out: PhraseRow[] = []
  const none = /^(无|没有|不适用|none|n\/a|nil|空|-|—|–)$/i
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || /^[|\-\s:]+$/.test(t)) continue
    const cols = t.split(/[|｜]/).map((c) => c.trim())
    if (cols.length < 2) continue
    const word = cols[0].replace(/^[\-*•\d.、\s]+/, '').trim()
    if (!word || /^(单词|word)$/i.test(word)) continue
    // 空 / 「无」= 没有该类的说法；**仍算「已标注」**（防止无限重复待办）
    const phrases = cols[1] && !none.test(cols[1]) ? splitList(cols[1]) : []
    const idioms = cols[2] && !none.test(cols[2]) ? splitList(cols[2]) : []
    out.push({ word, phrases, idioms })
  }
  return out
}

/** 把 AI 给的标记词归一成受控词表里的标准写法（容忍英文/别名）。 */
const MARK_ALIASES: Record<string, string> = {
  可数名词: '可数',
  countable: '可数',
  '不可数名词': '不可数',
  uncountable: '不可数',
  noncount: '不可数',
  及物动词: '及物',
  transitive: '及物',
  vt: '及物',
  不及物动词: '不及物',
  intransitive: '不及物',
  vi: '不及物',
  gradable: '可分级',
  ungradable: '不可分级',
  'non-gradable': '不可分级',
}

function normalizeMark(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  if ((GRAMMAR_MARKS as readonly string[]).includes(t)) return t
  const key = t.toLowerCase().replace(/\s+/g, '')
  if ((GRAMMAR_MARKS as readonly string[]).includes(key)) return key
  return MARK_ALIASES[key] ?? null
}

/** 解析语法标记表（`单词 | 标记1；标记2`）。只保留受控词表内的标记。 */
export function parseGrammarMarkTable(raw: string): GrammarMarkRow[] {
  const out: GrammarMarkRow[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || /^[|\-\s:]+$/.test(t)) continue
    const cols = t.split(/[|｜]/).map((c) => c.trim())
    if (cols.length < 2) continue
    const word = cols[0].replace(/^[\-*•\d.、\s]+/, '').trim()
    if (!word || /^(单词|word)$/i.test(word)) continue
    // 「无 / 不适用 / -」或留空 = 该词没有可标的标记；**仍算「已标注」**（防止无限重复待办）
    const marks = /^(无|没有|不适用|none|n\/a|nil|空|-|—|–)$/i.test(cols[1])
      ? []
      : (() => {
          const picked: string[] = []
          for (const part of cols[1].split(/[;；,，、\s/]+/)) {
            const m = normalizeMark(part)
            if (m && !picked.includes(m)) picked.push(m)
          }
          return picked
        })()
    out.push({ word, marks })
  }
  return out
}

/** 解析用法示例表（`word | 英 | 中 | 英 | 中`）。 */
export function parseExampleTable(raw: string): ExampleRow[] {
  const out: ExampleRow[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || /^[|\-\s:]+$/.test(t)) continue
    const cols = t.split(/[|｜]/).map((c) => c.trim())
    if (cols.length < 3) continue
    const word = cols[0].replace(/^[\-*•\d.、\s]+/, '').trim()
    if (!word || /^(单词|word)$/i.test(word)) continue
    const examples: { text: string; translation?: string }[] = []
    for (let i = 1; i + 1 < cols.length; i += 2) {
      const en = cleanExampleText(cols[i])
      const zh = cleanExampleText(cols[i + 1])
      if (!en) continue
      // 跑飞的长句（多半是 AI 跑题）直接丢
      if (en.split(/\s+/).length > 30) continue
      if (examples.some((e) => e.text.toLowerCase() === en.toLowerCase())) continue
      examples.push(zh ? { text: en, translation: zh } : { text: en })
    }
    if (!examples.length) continue
    // 优先留「真的含该词」的例句；全都不含（AI 用同义词糊弄）时宽松保留，避免任务反复跑
    const withWord = examples.filter((e) => exampleHasWord(e.text, word))
    out.push({ word, examples: withWord.length ? withWord : examples })
  }
  return out
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
