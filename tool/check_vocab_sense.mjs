/**
 * 词卡「义项一致性」门禁：卡片上词性 / 中文释义 / 英英释义必须说同一个义项。
 *
 * 用法：
 *   node tool/check_vocab_sense.mjs              默认检查 data/xueba.db
 *   node tool/check_vocab_sense.mjs --db <path>  指定库
 *   node tool/check_vocab_sense.mjs --all        连「来源可疑」的也当失败（默认只告警）
 *
 * 分类（和 core/vocab/sense.ts 的 senseConflict 同一套判断，这里是脚本版）：
 *   HARD ① 词性与释义首标打架（"v." + "n. 誓约"）—— 一眼自相矛盾，必须为 0
 *   HARD ② 单词条目的 word 里混进了省略号/整句（"term ... ..."）—— 词形被污染，必须为 0
 *   SOFT ③ 词典占位词性 + AI 语境释义，**且词典里这个词有多于一种词性** —— 只告警
 *
 * 为什么要有 HARD：这类错不是"数据脏"，是**两个义项被拼到一张卡上**，
 * 用户在背单词时看到的是自相矛盾的信息。让它在 CI 里红，比事后人工发现强。
 *
 * ③ 为什么必须限定「词典多词性」：占位词性取的是词典**释义第一行**的标记。
 * 如果这个词在词典里只有一个词性，那第一行就是唯一答案，标它没有任何意义
 * （曾经这样裸报，62 条里 48 条是「consul n. 领事」「proudly adv. 自豪地」这种完全正确的，
 * 告警一多就没人看了）。只有多词性时，第一行才可能不是语境里那个义项 —— `rival`
 * 就是词典只给了 `n. 对手 / a. 竞争的`（连动词义都没有），于是卡上出现「n. 与……匹敌」。
 */
import { existsSync, readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const dbPath = (() => {
  const i = args.indexOf('--db')
  return i >= 0 ? args[i + 1] : join(ROOT, 'data', 'xueba.db')
})()
const strict = args.includes('--all')

if (!existsSync(dbPath)) {
  console.log(`[vocab-sense] 没有数据库（${dbPath}），跳过`)
  process.exit(0)
}

const { DatabaseSync } = await import('node:sqlite')
const db = new DatabaseSync(dbPath, { readOnly: true })
const row = db.prepare('SELECT payload FROM vocab WHERE id = 1').get()
db.close()
if (!row) {
  console.log('[vocab-sense] 库里还没有词库，跳过')
  process.exit(0)
}

/**
 * `vocab.payload` 现在统一存 gzip BLOB（省磁盘），也兼容老库存的明文 TEXT。
 * 别直接 `String(payload)`：BLOB 会变成一串逗号数字，JSON.parse 当场炸。
 */
function decodePayload(payload) {
  if (typeof payload === 'string') return payload
  const buf = Buffer.from(payload)
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return gunzipSync(buf).toString('utf8')
  return buf.toString('utf8')
}

const items = JSON.parse(decodePayload(row.payload)).items ?? []

const CLASS = {
  n: 'n', noun: 'n',
  v: 'v', vt: 'v', vi: 'v', verb: 'v',
  a: 'adj', adj: 'adj', adjective: 'adj',
  ad: 'adv', adv: 'adv', adverb: 'adv',
  prep: 'prep', preposition: 'prep',
  conj: 'conj', conjunction: 'conj',
  pron: 'pron', pronoun: 'pron',
  num: 'num', numeral: 'num',
  art: 'art', article: 'art',
  interj: 'interj', interjection: 'interj',
}

const posClass = (pos) => {
  const raw = String(pos ?? '').trim().toLowerCase().replace(/\.+$/, '')
  if (!raw) return ''
  if (CLASS[raw]) return CLASS[raw]
  for (const part of raw.split(/[/、,，]/)) {
    const key = part.trim().replace(/\.+$/, '')
    if (CLASS[key]) return CLASS[key]
  }
  return raw
}

const posFromGloss = (meaning) => {
  const m = /^([a-z]{1,6})\.\s*\S/i.exec(String(meaning ?? '').trim())
  if (!m) return null
  const cls = CLASS[m[1].toLowerCase()]
  if (!cls) return null
  return cls === 'adj' ? 'adj.' : `${cls}.`
}

/** 单词条目的词形不该带标点/空格/整句（"term ... ..." 是真实病例）。 */
const pollutedWord = (word) => {
  const w = String(word ?? '').trim()
  if (!w) return true
  if (/\s/.test(w)) return false // 词组带空格是正常的，另有 kind='phrase' 认定
  return /[.…·]{2,}|[,;，；]/.test(w)
}

const LINE_POS = [
  [/^(n|noun)\.?\s/i, 'n'],
  [/^(v|vt|vi|verb)\.?\s/i, 'v'],
  [/^(a|adj)\.?\s/i, 'adj'],
  [/^(ad|adv)\.?\s/i, 'adv'],
  [/^(prep)\.?\s/i, 'prep'],
]

/** 一段释义（可能多行）里出现过哪几类词性标记。 */
function posClassesOfGloss(zh) {
  const out = new Set()
  for (const line of String(zh ?? '').split(/\n/)) {
    const t = line.trim()
    if (!t) continue
    for (const [re, cls] of LINE_POS) {
      if (re.test(t)) {
        out.add(cls)
        break
      }
    }
  }
  return out
}

/**
 * 词典里这个词有几种词性。
 *
 * 读 `public/ecdict.tsv` 的 zh 列（pos 列在本库是空的，词性只能从释义行首读）。
 * 词典不在就返回 null——门禁不因为缺词典就误报。
 */
function loadDictPosClasses() {
  const file = join(ROOT, 'public', 'ecdict.tsv')
  const map = new Map()
  if (!existsSync(file)) return null
  const unesc = (s) => String(s ?? '').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\')
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const c = line.split('\t')
    if (c.length < 5 || !c[0] || c[0] === 'word') continue
    map.set(c[0].toLowerCase(), posClassesOfGloss(unesc(c[4])))
  }
  return map
}

const hard = { mismatch: [], word: [] }
const soft = []
const dictPosClasses = loadDictPosClasses()
const normKey = (w) => String(w ?? '').trim().toLowerCase()
for (const it of items) {
  const word = String(it.word ?? '')
  const isPhrase = it.kind === 'phrase' || it.kind === 'usage' || word.includes(' ')
  if (!isPhrase && pollutedWord(word)) hard.word.push({ word, id: it.id })

  // 词组 / 用法笔记没有「词性」这回事（pos 只是从相关词条带过来的），不参与 ① ③
  if (isPhrase) continue

  const fromGloss = posFromGloss(it.meaning)
  if (fromGloss && it.partOfSpeech) {
    const a = posClass(it.partOfSpeech)
    const b = posClass(fromGloss)
    if (a && b && a !== b) hard.mismatch.push({ word, pos: it.partOfSpeech, meaning: String(it.meaning).slice(0, 30) })
  }

  const posSrc = it.fieldSources?.partOfSpeech
  const meaningSrc = it.fieldSources?.meaning
  if (it.partOfSpeech && posSrc === 'dict' && meaningSrc === 'ai') {
    const classes = dictPosClasses === null ? null : dictPosClasses.get(normKey(word))
    // 只有「词典里这个词本来就有多种词性」才值得怀疑：占位取的是释义第一行，
    // 多词性时第一行完全可能不是语境里那个义项。单词性的词第一行就是唯一答案，报它纯噪声。
    if (classes && classes.size > 1) {
      soft.push({ word, pos: it.partOfSpeech, meaning: String(it.meaning ?? '').slice(0, 30), classes: [...classes].join('/') })
    }
  }
}

const show = (list, n = 12) => {
  for (const x of list.slice(0, n)) {
    const detail = x.pos ? `[${x.pos}] ${x.meaning}` : x.word
    console.log(`   ${String(x.word ?? '').padEnd(18)} ${detail}`)
  }
  if (list.length > n) console.log(`   ……还有 ${list.length - n} 条`)
}

console.log(`[vocab-sense] ${dbPath} · 词条 ${items.length}`)
console.log(`① 词性与释义首标打架：${hard.mismatch.length}`)
if (hard.mismatch.length) show(hard.mismatch)
console.log(`② 单词的 word 被污染（省略号/整句）：${hard.word.length}`)
if (hard.word.length) show(hard.word)
console.log(`③ 词典有多个词性、占位可能选错义项（重查确认即可消掉）：${soft.length}`)
if (soft.length) {
  for (const x of soft.slice(0, 12)) {
    console.log(`   ${String(x.word).padEnd(18)} [${x.pos}] ${x.meaning}   ← 词典里有 ${x.classes}`)
  }
  if (soft.length > 12) console.log(`   ……还有 ${soft.length - 12} 条`)
}

const failed = hard.mismatch.length + hard.word.length + (strict ? soft.length : 0)
if (failed) {
  console.error(`\n[vocab-sense] 失败：${failed} 条自相矛盾的词卡。修法：node tool/audit-vocab.mjs --fix`)
  process.exit(1)
}
console.log('\n[vocab-sense] 通过')
