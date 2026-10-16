// ============================================================
// recover-vocab.mjs —— 「捞词」工具：把丢掉的词库从本机残留记录里重建出来
//
// 背景：词库存在 IndexedDB，被一次事故覆盖后只剩语言点。
// 但本机还留着不少词的痕迹（都在 localStorage 里），加上本地词典，
// 足以把「单词 + 音标 + 词性 + 释义 + 英英 + 例句」重建出来，再「导入备份」用起来。
//
// 输入（任一）：
//   · 浏览器导出的 dump：new/temp/reader-dump.json（键 → 原始字符串）
//   · 任意含词的数据文件：新/旧 ai-jobs-*.json（askedWords）、*.results.json（AI 结果 raw）
//   · 没有 dump 时的兜底：--from-articles 用 public/articles.json 的正文按级别挑词
//
// 用法：
//   node tools/recover-vocab.mjs                       # 自动找输入
//   node tools/recover-vocab.mjs new/temp/reader-dump.json
//   node tools/recover-vocab.mjs --from-articles       # 兜底：从文章正文重挑
//   node tools/recover-vocab.mjs --out new/recovered-library.json
//
// 输出：可被应用「打印/导出 → 导入备份」直接导入的 JSON（{ library: { schemaVersion, items } }）
// ============================================================
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const argOf = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const OUT = argOf('--out', 'new/recovered-library.json')

// ---------- 本地词典（有就用，没有就跳过该字段） ----------
function readLines(p) {
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n') : []
}
function loadEcdict() {
  const map = new Map()
  for (const line of readLines('public/ecdict.tsv')) {
    const c = line.split('\t')
    if (c.length < 5 || c[0] === 'word' || !c[0]) continue
    map.set(c[0].toLowerCase(), {
      word: c[0],
      phonetic: unesc(c[1]),
      pos: unesc(c[2]),
      en: unesc(c[3]),
      zh: unesc(c[4]),
    })
  }
  return map
}
function loadForms() {
  const map = new Map()
  for (const line of readLines('public/ecdict-forms.tsv')) {
    const i = line.indexOf('\t')
    if (i > 0) map.set(line.slice(0, i), line.slice(i + 1))
  }
  return map
}
function loadMwld() {
  const map = new Map()
  for (const line of readLines('public/mwld.tsv')) {
    const c = line.split('\t')
    if (c.length < 3 || !c[0]) continue
    map.set(c[0].toLowerCase(), { phonetic: c[1], pos: c[2], en: c[3] ?? '' })
  }
  return map
}
function loadTatoeba(max = 3) {
  const map = new Map()
  for (const line of readLines('public/tatoeba-en.tsv')) {
    const c = line.split('\t')
    if (c.length < 2 || !c[0]) continue
    const k = c[0].toLowerCase()
    const list = map.get(k) ?? []
    if (list.length < max) list.push({ text: c[1], translation: c[2] ?? undefined })
    if (!map.has(k)) map.set(k, list)
  }
  return map
}
const unesc = (s) => (s ?? '').replace(/\\\\n/g, '\n').replace(/\\+$/, '').trim()
const cleanGloss = (s) => (s ?? '').replace(/\\+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s;,，、]+|[\s;,，、]+$/g, '')
const firstLine = (s) => (s ?? '').split(/\\n|\n/).map((x) => x.trim()).filter(Boolean)[0] ?? ''
/** AI 有时把「无 / - / none」写进字段，当空处理。 */
const clearTag = (s) => {
  const t = (s ?? '').trim()
  return /^(无|-|—|none|null|n\/a)$/i.test(t) ? '' : t
}
const norm = (w) =>
  (w ?? '')
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u02bc\u2032]/g, "'")
    .replace(/[^A-Za-z' -]/g, '')
    .trim()
    .toLowerCase()

/** 顺手做个启发式原形（应用加载时还会用离线词典再校一遍）。 */
function lemmaOf(raw) {
  const w = norm(raw)
  if (!w) return ''
  if (w.includes(' ')) return w
  let s = w.replace(/'s$/, '')
  if (s.length <= 2) return s
  if (/(s|x|z|ch|sh)es$/.test(s)) s = s.slice(0, -2)
  else if (/ies$/.test(s) && s.length > 4) s = s.slice(0, -3) + 'y'
  else if (/[^s]s$/.test(s) && !/(us|ss|is|os)$/.test(s)) s = s.slice(0, -1)
  if (/ing$/.test(s) && s.length > 4) {
    let b = s.slice(0, -3)
    if (/([bcdgklmnprtvz])\1$/.test(b)) b = b.slice(0, -1)
    else if (/[^aeiou][aeiou][^aeiouwxy]$/.test(b)) b += 'e'
    s = b
  } else if (/ed$/.test(s) && s.length > 3) {
    let b = s.slice(0, -2)
    if (/([bcdgklmnprtvz])\1$/.test(b)) b = b.slice(0, -1)
    else if (/[^aeiou][aeiou][^aeiouwxy]$/.test(b)) b += 'e'
    s = b
  }
  return s
}

// ---------- 收集「词 + 来源句」 ----------
/** 词典（提前加载：提示词里抠词时要靠它过滤掉说明文字里的英文） */
const DICT = loadEcdict()
const FORMS = loadForms()
const inDict = (w) => DICT.has(norm(w)) || DICT.has(lemmaOf(w)) || FORMS.has(norm(w))
/** word -> { sentence?, sentenceId?, articleId? } */
const collected = new Map()
function add(word, extra = {}) {
  const raw = (word ?? '').toString().trim()
  const w = norm(raw)
  if (!w || !/^[A-Za-z][A-Za-z' -]*$/.test(w)) return
  const key = lemmaOf(w) || w
  const cur = collected.get(key)
  if (!cur) collected.set(key, { word: raw, key, ...extra })
  else {
    if (!cur.sentence && extra.sentence) Object.assign(cur, extra)
    if (!cur.ai && extra.ai) cur.ai = extra.ai
  }
}

/** AI 查词行：单词 | 音标 | 词性 | 中文含义 | 用法/搭配 | 例句(英 — 中) | 英文释义 */
function parseLookupLine(line) {
  const c = line.split('|').map((x) => x.trim())
  if (c.length < 4) return null
  const word = c[0]
  if (!/^[A-Za-z][A-Za-z' -]{0,40}$/.test(word)) return null
  const examples = (c[5] ?? '')
    .split(/\s*[;；]\s*|\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const i = x.search(/\s[—–-]\s/)
      return i > 0 ? { text: x.slice(0, i).trim(), translation: x.slice(i).replace(/^\s[—–-]\s/, '').trim() } : { text: x }
    })
    .filter((e) => e.text)
  return {
    word,
    ai: {
      phonetic: c[1] || '',
      pos: c[2] || '',
      meaning: cleanGloss(c[3] ?? ''),
      usage: c[4] || '',
      examples,
      definition: cleanGloss(c[6] ?? ''),
    },
  }
}

/** localStorage dump：{ 'reader:batch': '<json字符串>', ... } 或已解析的对象 */
function readDump(file) {
  const json = JSON.parse(readFileSync(file, 'utf8'))
  const get = (key) => {
    const v = json[key]
    if (v == null) return null
    if (typeof v === 'string') {
      try {
        return JSON.parse(v)
      } catch {
        return v
      }
    }
    return v
  }
  // batch：{ articleId: [{word,sentence,sentenceId}] } 或 [{...}]
  const batch = get('reader:batch')
  if (batch && typeof batch === 'object') {
    const groups = Array.isArray(batch) ? [['（未知篇）', batch]] : Object.entries(batch)
    for (const [articleId, list] of groups) {
      for (const b of list ?? []) {
        if (typeof b === 'string') add(b, { articleId })
        else add(b?.word, { articleId, sentence: b?.sentence, sentenceId: b?.sentenceId ?? null })
      }
    }
  }
  // mistakes：[{itemId:'vocab:run', label:'run'}]
  const mistakes = get('reader:mistakes')
  if (Array.isArray(mistakes)) {
    for (const m of mistakes) {
      const id = (m?.itemId ?? '').toString()
      add(id.startsWith('vocab:') ? id.slice(6) : m?.label, { articleId: '（恢复自错题本）' })
    }
  }
  // dictWords / 其它以数组存词的键
  for (const key of ['reader:dictWords', 'reader:confusableBatch']) {
    const v = get(key)
    if (Array.isArray(v)) for (const x of v) add(typeof x === 'string' ? x : x?.word)
  }
  // 上次导出的 AI 工作包（里面有问过哪些词）
  const pack = get('reader:aiJobPack')
  if (pack && Array.isArray(pack.jobs)) {
    for (const job of pack.jobs) for (const w of job?.askedWords ?? []) add(w, { articleId: '（恢复自工作包）' })
  }
  // 词库本身（万一 dump 里也带了 items）
  for (const key of ['reader:vocabItems', 'reader:library']) {
    const lib = get(key)
    if (lib && Array.isArray(lib.items)) for (const it of lib.items) add(it?.word, { sentence: it?.source?.sentenceText })
  }
}

/** AI 工作包（jobs-*.json）：里面记着「问过哪些词」 */
function readJobs(file) {
  let json
  try {
    json = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return 0
  }
  const jobs = Array.isArray(json) ? json : (json.jobs ?? [])
  let n = 0
  for (const job of jobs) {
    for (const w of job?.askedWords ?? []) {
      add(w)
      n++
    }
    // 兜底：提示词里「单词列表」那段（每行一个词 / 一行一个 | 表格）
    const prompt = typeof job?.prompt === 'string' ? job.prompt : ''
    for (const line of prompt.split(/\r?\n/)) {
      const t = line.trim()
      if (/^[A-Za-z][A-Za-z' -]{1,30}$/.test(t) && t.split(' ').length <= 4 && inDict(t)) {
        add(t)
        n++
      }
    }
  }
  return n
}

/** AI 结果文件（results 里的 raw 文本）：lookup 行 + auto_vocab 词表 */
function readResults(file) {
  let json
  try {
    json = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return 0
  }
  const results = Array.isArray(json) ? json : (json.results ?? [])
  let n = 0
  for (const r of results) {
    const raw = typeof r?.raw === 'string' ? r.raw : ''
    if (!raw) continue
    if (r.task === 'lookup' || /\|/.test(raw)) {
      for (const line of raw.split('\n')) {
        const cells = line.split('|').map((x) => x.trim())
        if (cells.length < 4) continue
        add(cells[0])
        n++
      }
    } else if (r.task === 'auto_vocab') {
      for (const line of raw.split('\n')) {
        const w = line.trim().split(/[,\s/|]+/)[0]
        if (w) add(w)
        n++
      }
    }
  }
  return n
}

/** 兜底：从内置文章正文按「四级以上」重挑（不需要 AI） */
function readFromArticles() {
  const j = JSON.parse(readFileSync('public/articles.json', 'utf8'))
  const dict = DICT
  const stop = new Set('the a an and or of to in on at for with from by as is are was were be been being that this these those it its he she they them his her their our your you we i not no but if then than so such can could may might will would shall should do does did done have has had having more most other some any all each both few many much own same too very just only also'.split(' '))
  for (const v of Object.values(j)) {
    for (const m of String(v?.text ?? '').matchAll(/[A-Za-z][A-Za-z'-]{3,}/g)) {
      const w = m[0].toLowerCase()
      if (stop.has(w)) continue
      // 四级以内（含 cet4/gk/zk/xx）的常见词不收，只要超纲的
      const e = dict.get(w) ?? dict.get(lemmaOf(w))
      if (!e) continue
      const tag = (e.tag || '').toLowerCase()
      if (/(cet4|gk|zk|xx)/.test(tag) && !/(cet6|ky|toefl|ielts|gre)/.test(tag)) continue
      add(w)
    }
  }
}

// ---------- 组装词库 ----------
function buildLibrary() {
  const dict = DICT
  const forms = FORMS
  const mwld = loadMwld()
  const tatoeba = loadTatoeba()
  const now = new Date().toISOString()
  const items = []

  for (const [key, rec] of collected) {
    const lemma = forms.get(norm(rec.word)) ?? key
    const e = dict.get(norm(rec.word)) ?? dict.get(lemma) ?? null
    const mw = mwld.get(norm(rec.word)) ?? mwld.get(lemma) ?? null
    const ai = rec.ai ?? null
    const meaning = cleanGloss(ai?.meaning) || cleanGloss(firstLine(e?.zh ?? '')) || null
    const phoneticRaw = (ai?.phonetic || mw?.phonetic || e?.phonetic || '').replace(/^\/+|\/+$/g, '')
    const phonetic = phoneticRaw ? `/${phoneticRaw}/` : null
    const pos = cleanGloss(ai?.pos || firstLine(mw?.pos || e?.pos || '')) || null
    const definition = cleanGloss(ai?.definition) || cleanGloss(firstLine(mw?.en || e?.en || '')) || null
    const usage = ai?.usage ? [ai.usage].filter(Boolean) : []
    const examples = []
    for (const ex of ai?.examples ?? []) {
      if (!ex.text || examples.some((x) => x.text === ex.text)) continue
      examples.push({ text: ex.text, translation: ex.translation, origin: 'ai' })
    }
    if (rec.sentence && !examples.some((x) => x.text === rec.sentence)) {
      examples.push({
        text: rec.sentence,
        articleId: rec.articleId ?? undefined,
        sentenceId: rec.sentenceId ?? undefined,
        origin: 'article',
      })
    }
    for (const ex of tatoeba.get(norm(rec.word)) ?? tatoeba.get(lemma) ?? []) {
      if (examples.some((x) => x.text === ex.text)) continue
      examples.push({ text: ex.text, translation: ex.translation, origin: 'tatoeba' })
      if (examples.length >= 6) break
    }
    items.push({
      id: `vocab:${lemma}`,
      word: rec.word,
      lemma,
      phonetic,
      partOfSpeech: pos,
      meaning,
      definition,
      usage,
      examples,
      source: rec.articleId
        ? { articleId: rec.articleId, fileName: null, sentenceId: rec.sentenceId ?? null, sentenceText: rec.sentence ?? '' }
        : null,
      status: meaning ? 'queried' : 'unqueried',
      note: '',
      tags: ['恢复'],
      contexts: [],
      reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
      createdAt: now,
      updatedAt: now,
    })
  }
  // 同 lemma 去重（保留信息更全的那条）
  const byLemma = new Map()
  for (const it of items) {
    const prev = byLemma.get(it.lemma)
    if (!prev) byLemma.set(it.lemma, it)
    else {
      const score = (x) => (x.meaning ? 1 : 0) + (x.phonetic ? 1 : 0) + x.examples.length
      if (score(it) > score(prev)) byLemma.set(it.lemma, it)
    }
  }
  const finalItems = [...byLemma.values()]
  return {
    items: finalItems,
    raw: items.length,
    withMeaning: finalItems.filter((it) => it.meaning).length,
    withPhonetic: finalItems.filter((it) => it.phonetic).length,
    withExamples: finalItems.filter((it) => it.examples.length).length,
  }
}

// ---------- main ----------
const files = args.filter((a) => !a.startsWith('--') && a !== OUT)
const candidates = files.length
  ? files
  : [
      ...readdirSync('new/temp', { withFileTypes: true })
        .filter((d) => d.isFile() && /\.json$/i.test(d.name))
        .map((d) => join('new/temp', d.name)),
    ].filter((f) => {
      const n = basename(f).toLowerCase()
      return /dump|recover|localstorage|ai-jobs|results|jobs-|out-/.test(n)
    })

if (flag('--from-articles') || !candidates.length) {
  if (!flag('--from-articles')) {
    console.log('· 没找到 dump/工作包文件 → 用 --from-articles 的兜底策略（从文章正文挑超纲词）')
  }
  readFromArticles()
  console.log('· 文章正文挑词完成')
}

for (const f of candidates) {
  if (!existsSync(f) || !statSync(f).isFile()) continue
  const n = basename(f).toLowerCase()
  try {
    if (/dump|recover|localstorage/.test(n)) {
      readDump(f)
      console.log(`· 读到 dump：${f}`)
    } else if (/jobs-/.test(n)) {
      const got = readJobs(f)
      console.log(`· 读到工作包：${f}（${got} 个词）`)
    } else {
      const got = readResults(f)
      console.log(`· 读到 AI 结果：${f}（${got} 行）`)
    }
  } catch (e) {
    console.log(`· 跳过 ${f}：${e.message}`)
  }
}

const { items, raw, withMeaning, withPhonetic, withExamples } = buildLibrary()
const payload = {
  version: 1,
  exportedAt: new Date().toISOString(),
  library: { schemaVersion: 1, items },
  note: '由 tools/recover-vocab.mjs 从本机残留记录重建（释义/音标来自离线词典）',
}
writeFileSync(OUT, JSON.stringify(payload, null, 2))

console.log('\n===== 捞词结果 =====')
console.log(`收集到的词：${raw} → 去重后词条：${items.length}`)
console.log(`有释义：${withMeaning}（${items.length ? Math.round((withMeaning / items.length) * 100) : 0}%）`)
console.log(`有音标：${withPhonetic}`)
console.log(`有例句：${withExamples}`)
console.log(`输出：${OUT}`)
console.log('\n下一步：应用里「🖨 打印 / 导出…」→ 底部「导入备份」→ 选这个文件 → 词条就回来了。')
console.log('（复习排期/掌握状态没法恢复；释义可用侧栏「补齐生词本」再本地补一遍。）')
