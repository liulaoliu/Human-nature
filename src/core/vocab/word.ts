/**
 * 词形与释义：归一化、lemma 还原、词性/释义清洗。
 *
 * 纯函数，其他 vocab 子模块都从这里取「词形怎么算」的唯一口径。
 */

/** 不规则形 → 原形。规则表覆盖不到的常见词放这里。 */
const IRREGULAR: Record<string, string> = {
  am: 'be', is: 'be', are: 'be', was: 'be', were: 'be', been: 'be', being: 'be',
  has: 'have', had: 'have', having: 'have',
  does: 'do', did: 'do', done: 'do', doing: 'do',
  goes: 'go', went: 'go', gone: 'go',
  ran: 'run', runs: 'run',
  children: 'child', men: 'man', women: 'woman', people: 'person',
  mice: 'mouse', feet: 'foot', teeth: 'tooth', geese: 'goose',
  better: 'good', best: 'good', worse: 'bad', worst: 'bad',
  made: 'make', took: 'take', gave: 'give', came: 'come', became: 'become',
  saw: 'see', knew: 'know', said: 'say', found: 'find', told: 'tell',
  thought: 'think', got: 'get', wrote: 'write', drove: 'drive',
  using: 'use', uses: 'use', used: 'use',
}

/** 把词形归一化成小写、统一撇号/连字符，去掉标点。 */
export function normalizeWord(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u02bc\u2032]/g, "'")
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[^A-Za-z'\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * 取 lemma（去重用的归一化形式）。
 *
 * 这是启发式还原，不是完整词形还原：不规则形查表，其余走少量后缀规则
 * （复数、-ing、-ed）。覆盖不到的会偏，但同形/同词的常见变体能合并，
 * 后续可整体换成更完整的词形还原库。
 */
export function lemmaOf(raw: string): string {
  const w = normalizeWord(raw)
  if (!w) return ''
  // 短语（含空格）不做词形还原，原样作为去重键
  if (w.includes(' ')) return w
  if (IRREGULAR[w]) return IRREGULAR[w]
  let s = w.replace(/'s$/, '')
  if (s.length <= 2) return s

  if (/(s|x|z|ch|sh)es$/.test(s)) s = s.slice(0, -2)
  else if (/ies$/.test(s) && s.length > 4) s = s.slice(0, -3) + 'y'
  else if (/[^s]s$/.test(s) && !/(us|ss|is|os)$/.test(s)) s = s.slice(0, -1)

  if (/ing$/.test(s) && s.length > 4) {
    let base = s.slice(0, -3)
    if (/([bcdgklmnprtvz])\1$/.test(base)) base = base.slice(0, -1)
    else if (/[^aeiou][aeiou][^aeiouwxy]$/.test(base)) base += 'e'
    s = base
  } else if (/ed$/.test(s) && s.length > 3) {
    let base = s.slice(0, -2)
    if (/([bcdgklmnprtvz])\1$/.test(base)) base = base.slice(0, -1)
    else if (/[^aeiou][aeiou][^aeiouwxy]$/.test(base)) base += 'e'
    s = base
  }
  return s
}

/** 屈折后缀：加上它只是同一个词的变形，不是另一个词。 */
const INFLECTION = new Set(['s', 'es', 'd', 'ed', 'ing', 'n', 'en'])

/**
 * AI 说「A 的原形是 B」时，能不能真把词条从 A 改名成 B。
 *
 * 2026-10-22 的血案：`-ing/-ed 辨析` 拿 AI 给的原形直接改词条的 word，
 * 而 AI 会把**加前缀派生出来的另一个词**当成词形变化：
 * `unchallenged → challenge`、`unarticulated → articulate`、`inarticulate → articulate`。
 * 改名只动 word/lemma/id，**释义、用法、例句都不动**，于是
 * 「challenge」这张卡上挂着 unchallenged 的词典释义（n./adj. 张冠李戴）。
 *
 * 所以这里只认**屈折**，不认派生：
 *   - 不规则表（went→go、better→good）；
 *   - 在词干后面接屈折后缀（runs→run、watched→watch、swelling→swell）；
 *   - 双写尾辅音（running→run）、去 e 加 -ing/-ed（expunging→expunge）；
 *   - y→ies（companies→company）、-ses→-sis（analyses→analysis）。
 * 加/去任何**派生**词缀一律拒绝：un-/in-/im-/ir-/il-/dis-/non-/anti-/mis-（前缀），
 * -ly/-ness/-less/-ful/-ment/-tion/-able/-ity/-ism/-ist/-er/-or/-al/-ic/-ous（后缀）。
 * 拒绝的代价只是「词形没被规整」，误改的代价是整张卡的释义张冠李戴——宁严不宽。
 */
export function canRewriteTo(from: string, to: string): boolean {
  const f = normalizeWord(from)
  const t = normalizeWord(to)
  if (!f || !t) return false
  if (f === t) return true
  if (IRREGULAR[f] === t) return true
  // 只处理单词：短语（含空格）不做改名判断，交给原来的「同形才改」
  if (f.includes(' ') || t.includes(' ')) return false

  // 词干 + 屈折后缀（含词尾变化）
  if (f.startsWith(t)) {
    const rest = f.slice(t.length)
    if (INFLECTION.has(rest)) return true
    // 双写尾辅音：run → running / plan → planned（词干末尾那个字母再写一遍）
    if (rest === t.slice(-1) + 'ing' || rest === t.slice(-1) + 'ed') return true
  }
  // 去 e 再加 -ing/-ed：expunge → expunging / expunged
  if (t.endsWith('e') && (f === t.slice(0, -1) + 'ing' || f === t.slice(0, -1) + 'ed')) return true
  // 辅音 + y → ies：company → companies
  if (t.endsWith('y') && f === t.slice(0, -1) + 'ies') return true
  // -sis → -ses：analysis → analyses
  if (t.endsWith('sis') && f === t.slice(0, -2) + 'es') return true
  return false
}

/** 词性全称 → 缩写（离线词典/AI 有时给 "noun" 全称）。 */
const POS_ABBR: Record<string, string> = {
  noun: 'n.',
  verb: 'v.',
  adjective: 'adj.',
  adverb: 'adv.',
  preposition: 'prep.',
  conjunction: 'conj.',
  pronoun: 'pron.',
  numeral: 'num.',
  article: 'art.',
  interjection: 'interj.',
}

/** 规范化词性显示：「noun」→「n.」。 */
export function normalizePos(pos: string | null | undefined): string {
  const p = (pos ?? '').trim()
  if (!p) return ''
  const key = p.toLowerCase().replace(/\.+$/, '').trim()
  return POS_ABBR[key] ?? p
}

/**
 * 清洗释义/英英：数据里常见行尾转义残留的「\」（ECDICT/AI 都有），
 * 还有多余空白与首尾分隔符。中文英文都过一遍。
 */
export function cleanGloss(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/\\+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s;,.，、]+/, '')
    .replace(/[\s;,，、]+$/, '')
    .trim()
}

/** 若释义开头与词性重复（词性 n. 且释义以「n. 」或「noun 」开头），去掉重复那段。 */
export function stripLeadingPos(pos: string | null | undefined, gloss: string): string {
  const abbr = normalizePos(pos)
  if (!abbr) return gloss
  const tokens = [abbr, (pos ?? '').trim()].filter(Boolean)
  let out = gloss
  for (const t of tokens) {
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp('^\\s*' + esc + '\\.?\\s*', 'i'), '')
  }
  return out.trim()
}

/** 词条的展示用中释义（清洗 + 去重复词性）。 */
export function displayMeaning(item: { partOfSpeech: string | null; meaning: string | null }): string {
  return stripLeadingPos(item.partOfSpeech, cleanGloss(item.meaning))
}
