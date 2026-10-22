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
 *   SOFT ③ 词典占位的词性 + AI 的语境释义（可能对，也可能像 rival 那样错）—— 只告警
 *
 * 为什么要有 HARD：这类错不是"数据脏"，是**两个义项被拼到一张卡上**，
 * 用户在背单词时看到的是自相矛盾的信息。让它在 CI 里红，比事后人工发现强。
 */
import { existsSync } from 'node:fs'

const args = process.argv.slice(2)
const dbPath = (() => {
  const i = args.indexOf('--db')
  return i >= 0 ? args[i + 1] : 'data/xueba.db'
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

const items = JSON.parse(String(row.payload)).items ?? []

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

const hard = { mismatch: [], word: [] }
const soft = []
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
    soft.push({ word, pos: it.partOfSpeech, meaning: String(it.meaning ?? '').slice(0, 30) })
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
console.log(`③ 词典占位词性 + AI 语境释义（可疑，人工/重查确认）：${soft.length}`)
if (soft.length) show(soft)

const failed = hard.mismatch.length + hard.word.length + (strict ? soft.length : 0)
if (failed) {
  console.error(`\n[vocab-sense] 失败：${failed} 条自相矛盾的词卡。修法：node tool/audit-vocab.mjs --fix`)
  process.exit(1)
}
console.log('\n[vocab-sense] 通过')
