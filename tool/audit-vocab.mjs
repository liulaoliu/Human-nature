#!/usr/bin/env node
/**
 * 词库体检：找出「词性 / 释义张冠李戴」的词条（默认只读，不改任何东西）。
 *
 *   node tool/audit-vocab.mjs              # 只报告
 *   node tool/audit-vocab.mjs --fix        # 修 A 类（先关掉应用再跑）
 *   node tool/audit-vocab.mjs --db <path>  # 指定数据库
 *
 * 为什么要这个工具：2026-10-22 用户报「dwarf / consort / challenge / articulate 词性
 * 或者释义错了，还有别的」。根因有两条（都已修，见 core/vocab/word.ts 的 canRewriteTo
 * 与 core/dictEnrich.ts 的「词性只在补释义时才补」）：
 *
 *   A. **词形被改成派生词**：`-ing/-ed 辨析` 拿 AI 给的原形直接改词条 word，
 *      而 AI 把「加前缀造出来的另一个词」当词形变化（unchallenged → challenge、
 *      unarticulated → articulate）。改 word 不动释义 → challenge 卡上挂着
 *      unchallenged 的词典释义。证据留在 `note` 里：`[辨析] <原词形> — …`。
 *   B. **词性和释义来自不同义项**：词典补的词性是词头最常用义项，AI 给的是语境义项
 *      （consort 卡上「n. 交往；厮混」）。
 *
 * A 类可以按 note 里的原词形**证据式回改**（释义本来就是那个词的，改回去就对了）；
 * B 类不下结论，只列出来让人看。--fix 只动 A 类。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const fix = args.includes('--fix')
const dbArg = args.indexOf('--db') >= 0 ? args[args.indexOf('--db') + 1] : null
const DB = dbArg ? resolve(dbArg) : join(ROOT, 'data', 'xueba.db')

const norm = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z'\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** 屈折后缀——和 core/vocab/word.ts 的 canRewriteTo 同一口径（这里只用于判断 A 类）。 */
const INFLECTION = new Set(['s', 'es', 'd', 'ed', 'ing', 'n', 'en'])

/** `from` 是不是 `to` 的屈折形式（近似版：够判报告，不参与生产逻辑）。 */
function isInflection(from, to) {
  if (!from || !to) return false
  if (from === to) return true
  if (from.startsWith(to)) {
    const rest = from.slice(to.length)
    if (INFLECTION.has(rest)) return true
    if (rest === to.slice(-1) + 'ing' || rest === to.slice(-1) + 'ed') return true
  }
  if (to.endsWith('e') && (from === to.slice(0, -1) + 'ing' || from === to.slice(0, -1) + 'ed')) return true
  if (to.endsWith('y') && from === to.slice(0, -1) + 'ies') return true
  if (to.endsWith('sis') && from === to.slice(0, -2) + 'es') return true
  return false
}

/** ECDICT 释义开头带的词性标记 → 归一化类别。 */
const POS_TAG = [
  [/^(n|noun)\.?\s/i, 'n'],
  [/^(v|vt|vi|verb|t)\.?\s/i, 'v'],
  [/^(a|adj|adjective)\.?\s/i, 'adj'],
  [/^(ad|adv|adverb)\.?\s/i, 'adv'],
  [/^(prep)\.?\s/i, 'prep'],
]

function posClass(pos) {
  const p = String(pos ?? '').trim().toLowerCase().replace(/\.+$/, '')
  if (!p) return ''
  if (p === 'n' || p === 'noun') return 'n'
  if (['v', 'vt', 'vi', 'verb', 't'].includes(p)) return 'v'
  if (p === 'a' || p === 'adj' || p === 'adjective') return 'adj'
  if (p === 'ad' || p === 'adv' || p === 'adverb') return 'adv'
  if (p === 'prep' || p === 'preposition') return 'prep'
  return p
}

function meaningPosClass(meaning) {
  const m = String(meaning ?? '').trim()
  for (const [re, k] of POS_TAG) if (re.test(m)) return k
  return ''
}

/** 从 note 里取 `[辨析] <surface> — …` 的 surface。 */
function surfaceFromNote(note) {
  const m = /\[辨析\]\s*(.+?)\s*—/.exec(String(note ?? ''))
  return m ? m[1].trim() : ''
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 这段文本里有没有出现这个词（连字符 / 空格写法都算）。
 * 只认整词：`fund` 不会命中 `funded`，`describe` 不会命中 `described`。
 */
function hasWord(text, word) {
  const s = String(text ?? '')
  const w = String(word ?? '').toLowerCase().trim()
  if (!s || !w) return false
  const parts = w.split(/[- ]+/).filter(Boolean).map(escapeRe)
  if (!parts.length) return false
  return new RegExp(`\\b${parts.join('[- ]?')}\\b`, 'i').test(s)
}

/** 读离线词典（只取 词条 / 中释 / 英释 / 词性列）。 */
function loadEcdict() {
  const map = new Map()
  const file = join(ROOT, 'public', 'ecdict.tsv')
  if (!existsSync(file)) return map
  const lines = readFileSync(file, 'utf8').split('\n')
  const unesc = (s) => String(s ?? '').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\')
  for (const line of lines) {
    const c = line.split('\t')
    if (c.length < 5 || !c[0] || c[0] === 'word') continue
    map.set(c[0].toLowerCase(), { pos: unesc(c[2]), en: unesc(c[3]), zh: unesc(c[4]) })
  }
  return map
}

const LINE_POS = [
  [/^(n|noun)\.?\s/i, 'n'],
  [/^(v|vt|vi|verb|t)\.?\s/i, 'v'],
  [/^(a|adj|s)\.?\s/i, 'adj'],
  [/^(ad|adv|adverb)\.?\s/i, 'adv'],
  [/^(prep)\.?\s/i, 'prep'],
]
const ABBR = { n: 'n.', v: 'v.', adj: 'adj.', adv: 'adv.', prep: 'prep.' }

/** 释义第一行带的词性 → 缩写（拿不到就空串）。 */
function posFromGloss(zh) {
  for (const line of String(zh ?? '').split(/\\n|\n/)) {
    const t = line.trim()
    if (!t) continue
    const hit = LINE_POS.find(([re]) => re.test(t))
    return hit ? ABBR[hit[1]] : ''
  }
  return ''
}

/** 按词性挑一行释义（挑不到退回第一行）。顺手清掉 ECDICT 行尾残留的 `\` 与多余空白。 */
function firstGloss(text, pos) {
  const clean = (s) => s.replace(/\\+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s;,.，、]+/, '').replace(/[\s;,，、]+$/, '').trim()
  const lines = String(text ?? '')
    .split(/\\n|\n/)
    .map((x) => clean(x))
    .filter(Boolean)
  if (!lines.length) return ''
  const cls = LINE_POS.find(([re]) => re.test(String(pos ?? '') + ' '))
  if (cls) {
    const hit = lines.find((t) => {
      const m = LINE_POS.find(([re]) => re.test(t))
      return m && m[1] === cls[1]
    })
    if (hit) return hit
  }
  return lines[0]
}

/** 这个词条现在的释义是不是「另一个词」的词典释义（合并时串进来的）。 */
function glossBelongsTo(dict, word, meaning) {
  const e = dict.get(norm(word))
  if (!e || !meaning) return false
  const target = String(meaning).replace(/\\+/g, ' ').replace(/\s+/g, ' ').trim()
  return String(e.zh || '')
    .split(/\\n|\n/)
    .some((line) => line.replace(/\\+/g, ' ').replace(/\s+/g, ' ').trim() === target)
}

/** 这个词在离线词典里的某一行释义（没收录返回空串）。 */
function dictGloss(dict, word, pos) {
  const e = dict.get(norm(word))
  return e ? firstGloss(e.en, pos) : ''
}

/**
 * B 类修法：让词性和释义自洽。
 *
 * 词性通常来自 M-W / 词典 pos 列（**词头最常用**的义项），释义是 `firstLine(zh)`（**另一条**义项），
 * 于是卡上出现「v. n. 誓约」。优先把释义换成**与词性匹配的那一行**（信息量更大）；
 * 词典里没有那一行（blacklist 只有名词释义），就反过来让词性跟着释义走。
 */
function alignPosWithGloss(it, dict) {
  if (it.kind || String(it.word ?? '').includes(' ')) return null
  const a = posClass(it.partOfSpeech)
  const b = meaningPosClass(it.meaning)
  if (!a) return null
  if (a === b) return null
  if (!b) {
    // 释义没标记：英英写成 `to …` 就是动词释义（dwarf / consort 的真实病例）
    if (a === 'v' || !/^to\s+[a-z]/i.test(String(it.definition ?? '').trim())) return null
    return {
      ...it,
      partOfSpeech: 'v.',
      fieldSources: { ...(it.fieldSources ?? {}), partOfSpeech: it.fieldSources?.definition ?? 'ai' },
      updatedAt: new Date().toISOString(),
    }
  }
  const e = dict.get(norm(it.word))
  if (e) {
    const line = firstGloss(e.zh, it.partOfSpeech)
    if (line && meaningPosClass(line) === a) {
      return {
        ...it,
        meaning: line,
        fieldSources: { ...(it.fieldSources ?? {}), meaning: 'dict' },
        status: 'queried',
        updatedAt: new Date().toISOString(),
      }
    }
  }
  return {
    ...it,
    partOfSpeech: ABBR[b] ?? it.partOfSpeech,
    fieldSources: { ...(it.fieldSources ?? {}), partOfSpeech: it.fieldSources?.meaning ?? 'dict' },
    updatedAt: new Date().toISOString(),
  }
}

/**
 * 复合词的词性（和 `core/ecdict.ts` 的 guessCompoundPos 同一口径）：
 * 只看末段后缀，判不出来就返回空串。`waiting-times` 这种词性不明的不硬标。
 */
const COMPOUND_SUFFIX = [
  [/(?:ed|ing|less|ful|ous|ive|able|ible|ant|ent|al|like|free|made|blind|proof|wide|odd|worthy)$/i, 'adj.'],
  [/ly$/i, 'adv.'],
]

function compoundPos(word) {
  const w = String(word ?? '').trim()
  if (!w.includes('-')) return ''
  const last = w.split('-').filter(Boolean).pop() ?? ''
  if (last.length < 3 || !/^[a-z]+$/i.test(last)) return ''
  for (const [re, pos] of COMPOUND_SUFFIX) if (re.test(last)) return pos
  return ''
}

/**
 * 给「空白单词卡」补词典内容（--fill）。
 *
 * 只补空的，且**只补词典里只有一种词性的词**：多词性的词取释义第一行会踩到冷僻义
 * （`pale` 的第一行是「n. 栅栏, 界线」，正文里十次有九次是形容词）——
 * 这种卡留着空白交给 AI 查词，比填一条误导的释义强。
 */
function fillEmpty(it, dict) {
  if (it.kind || String(it.word ?? '').includes(' ')) return null
  if (it.fieldSources?.partOfSpeech === 'manual' || it.fieldSources?.meaning === 'manual') return null
  const iso = new Date().toISOString()
  const guess = it.partOfSpeech ? '' : compoundPos(it.word)

  // 已经有内容：只可能补一个判出来的词性
  if (it.meaning || it.definition || it.partOfSpeech) {
    return guess ? { ...it, partOfSpeech: guess, updatedAt: iso } : null
  }
  const e = dict.get(norm(it.word))
  if (!e) return guess ? { ...it, partOfSpeech: guess, updatedAt: iso } : null
  const classes = new Set()
  for (const line of String(e.zh ?? '').split(/\\n|\n/)) {
    const t = line.trim()
    if (!t) continue
    for (const [re, k] of POS_TAG) {
      if (re.test(t)) {
        classes.add(k)
        break
      }
    }
  }
  if (classes.size !== 1) return null
  const pos = posFromGloss(e.zh) || guess
  const meaning = firstGloss(e.zh, pos)
  if (!meaning) return null
  return {
    ...it,
    partOfSpeech: pos || null,
    meaning,
    definition: firstGloss(e.en, pos) || null,
    fieldSources: { partOfSpeech: 'dict', meaning: 'dict', definition: 'dict' },
    status: 'queried',
    updatedAt: iso,
  }
}

async function main() {
  if (!existsSync(DB)) {
    console.error(`找不到数据库：${DB}`)
    process.exit(1)
  }
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(DB, { readOnly: !fix })
  const row = db.prepare('SELECT payload FROM vocab WHERE id = 1').get()
  if (!row) {
    console.error('vocab 表里没有 payload（id=1）')
    process.exit(1)
  }
  const lib = JSON.parse(String(row.payload))
  const items = Array.isArray(lib.items) ? lib.items : []

  const renameWrong = [] // A
  const posMismatch = [] // B
  const verbSense = [] // C
  const empty = [] // D
  for (const it of items) {
    const word = String(it.word ?? '')
    // 只体检「单个单词」的词条：词组 / 习语 / 用法笔记的 word 里带空格或整句说明，
    // 它们的 partOfSpeech 是语言点带的，跟释义开头标记不是一回事。
    if (word.includes(' ') || it.kind) continue
    if (!it.meaning && !it.definition) empty.push(word)
    const surface = surfaceFromNote(it.note)
    if (surface && !surface.includes(' ') && norm(surface) !== norm(word) && !isInflection(norm(surface), norm(word))) {
      renameWrong.push({ it, word, surface })
    }
    const a = posClass(it.partOfSpeech)
    const b = meaningPosClass(it.meaning)
    if (a && b && a !== b) posMismatch.push({ it, word, pos: it.partOfSpeech, meaning: String(it.meaning) })
    // 释义没带标记、但英英是动词释义（`to …`），词性却写成名词/形容词 → 讲的是另一个义项
    else if (a && a !== 'v' && !b && /^to\s+[a-z]/i.test(String(it.definition ?? '').trim())) {
      verbSense.push({ it, word, pos: it.partOfSpeech, meaning: String(it.meaning) })
    }
  }

  console.log(`词库：${DB}`)
  console.log(`词条：${items.length}`)
  console.log('')
  console.log(`A. 词形被改成派生词（note 里的原词形 ≠ word）：${renameWrong.length}`)
  for (const { word, surface, it } of renameWrong) {
    const stray = (it.examples ?? []).filter((e) => !hasWord(e.text, surface)).length
    console.log(`   ${word}  ←应为→  ${surface}${stray ? `（另有 ${stray} 条例句讲的是 ${word}）` : ''}`)
  }
  console.log('')
  console.log(`B. 词性与释义开头标记打架：${posMismatch.length}`)
  for (const { word, pos, meaning } of posMismatch.slice(0, 30)) console.log(`   ${word}  [${pos}] ${meaning.slice(0, 40)}`)
  if (posMismatch.length > 30) console.log(`   ……还有 ${posMismatch.length - 30} 条`)
  console.log('')
  console.log(`C. 释义是动词义（英英以 to 开头）、词性却是别的：${verbSense.length}`)
  for (const { word, pos, meaning } of verbSense.slice(0, 30)) console.log(`   ${word}  [${pos}] ${meaning.slice(0, 40)}`)
  if (verbSense.length > 30) console.log(`   ……还有 ${verbSense.length - 30} 条`)
  console.log('')
  console.log(`D. 标了词却还空白的单词卡（--fill 用词典补）：${empty.length}`)
  for (const w of empty.slice(0, 20)) console.log(`   ${w}`)

  if (!fix) {
    if (renameWrong.length || posMismatch.length || verbSense.length || empty.length)
      console.log('\n要修：先关掉应用，再跑 `node tool/audit-vocab.mjs --fix`')
    db.close()
    return
  }

  if (!renameWrong.length && !posMismatch.length && !verbSense.length && !empty.length) {
    console.log('\n没有要修的')
    db.close()
    return
  }
  db.close()

  const dict = loadEcdict()

  // 走和线上一样的读写路径：loadVocab → 改 → saveVocab（派生表同事务重建）
  const { openStore } = await import('../server/sqliteStore.ts')
  const store = openStore(DB)
  if (!store) {
    console.error('打不开 store（需要 Node 22.5+ 的 node:sqlite）')
    process.exit(1)
  }
  try {
    const cur = store.loadVocab()
    if (!cur) {
      console.error('loadVocab 返回空')
      process.exit(1)
    }
    let moved = 0
    let spawned = 0
    let aligned = 0
    let filledCount = 0
    const out = []
    for (const it of cur.items) {
      const surface = surfaceFromNote(it.note)
      // 只动「单个单词」的词条，和上面体检的口径一致：
      // 词组 / 习语 / 用法笔记（word 里带空格或带 kind）的词形是它的身份，不能按 participle 改
      if (
        !surface ||
        surface.includes(' ') ||
        String(it.word).includes(' ') ||
        it.kind ||
        norm(surface) === norm(it.word) ||
        isInflection(norm(surface), norm(it.word))
      ) {
        const fixedItem = alignPosWithGloss(it, dict)
        if (fixedItem) {
          aligned++
          if (process.env.AUDIT_DEBUG)
            console.log('  [align]', it.word, JSON.stringify(it.partOfSpeech), '→', JSON.stringify(fixedItem.partOfSpeech), '|', JSON.stringify(String(it.meaning ?? '').slice(0, 24)))
        }
        const filled = fillEmpty(fixedItem ?? it, dict)
        if (filled) {
          filledCount++
          if (process.env.AUDIT_DEBUG)
            console.log('  [fill]', it.word, '→', filled.partOfSpeech, '|', String(filled.meaning ?? '').slice(0, 24))
        }
        out.push(filled ?? fixedItem ?? it)
        continue
      }
      const word = String(it.word)
      // 这条词条整个属于 surface（释义 / 用法 / 辨析笔记都是它的），先把它改回去
      const keep = (e) => hasWord(e.text, surface) || !hasWord(e.text, word)
      const back = { ...it, word: surface, lemma: norm(surface), id: `vocab:${norm(surface)}` }
      back.examples = (it.examples ?? []).filter(keep)
      back.contexts = (it.contexts ?? []).filter(keep)

      const fs = { ...(it.fieldSources ?? {}) }
      // 释义如果其实是**另一个词**的词典释义（合并时串进来的），不能留着
      if (glossBelongsTo(dict, word, it.meaning)) {
        const own = dict.get(norm(surface))
        const ownMeaning = own ? firstGloss(own.zh, it.partOfSpeech) : ''
        back.meaning = ownMeaning || null
        back.partOfSpeech = ownMeaning ? posFromGloss(ownMeaning) || null : null
        for (const f of ['meaning', 'partOfSpeech']) {
          if (ownMeaning) fs[f] = 'dict'
          else delete fs[f]
        }
      }
      // 英英释义：按 surface 查；查不到就清掉——留着的一定是原来那个词的
      const ownEn = dictGloss(dict, surface, back.partOfSpeech)
      back.definition = ownEn || null
      if (ownEn) fs.definition = 'dict'
      else delete fs.definition
      back.fieldSources = Object.keys(fs).length ? fs : undefined
      if (!back.meaning) back.status = 'unqueried'
      back.updatedAt = new Date().toISOString()
      out.push(back)
      moved++
      // 串进来的那几条（讲 word 的）挪回一个干净的 word 词条
      const strayEx = (it.examples ?? []).filter((e) => word && hasWord(e.text, word) && !hasWord(e.text, surface))
      const strayCx = (it.contexts ?? []).filter((c) => word && hasWord(c.sentenceText, word) && !hasWord(c.sentenceText, surface))
      if (!strayEx.length && !strayCx.length) continue
      const dictHit = dict.get(norm(word))
      const pos = dictHit ? posFromGloss(dictHit.zh) : ''
      out.push({
        ...it,
        id: `vocab:${norm(word)}`,
        word,
        lemma: norm(word),
        partOfSpeech: pos || null,
        meaning: dictHit ? firstGloss(dictHit.zh, pos) : null,
        definition: dictHit ? firstGloss(dictHit.en, pos) : null,
        fieldSources: dictHit ? { partOfSpeech: 'dict', meaning: 'dict', definition: 'dict' } : undefined,
        usage: [],
        phrases: [],
        idioms: [],
        note: '',
        confusables: undefined,
        examples: strayEx,
        contexts: strayCx,
        status: dictHit ? 'queried' : 'unqueried',
        updatedAt: new Date().toISOString(),
      })
      spawned++
    }
    await store.saveVocab({ ...cur, items: out })
    console.log(`\n已回改 ${moved} 条词形；拆分出 ${spawned} 条被打乱的词；对齐 ${aligned} 条词性与释义；补空 ${filledCount} 条`)
  } finally {
    store.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
