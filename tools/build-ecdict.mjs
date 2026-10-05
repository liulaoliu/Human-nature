#!/usr/bin/env node
/**
 * build-ecdict.mjs —— 把 ECDICT 的 ecdict.csv 预处理成浏览器能用的紧凑索引。
 *
 * 产出（都进 .gitignore，不进仓库）：
 *   public/ecdict.tsv        词条：word \t phonetic \t pos \t en \t zh \t tag \t collins \t oxford \t bnc \t frq
 *   public/ecdict-forms.tsv  词形→原型：form \t lemma
 *
 * 用法：node tools/build-ecdict.mjs [csv路径]
 * 默认读取 data/ECDICT-master/ECDICT-master/ecdict.csv。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

const CSV =
  process.argv[2] || 'data/ECDICT-master/ECDICT-master/ecdict.csv'
if (!existsSync(CSV)) {
  console.error(`找不到 ${CSV}（先把 ECDICT 的 ecdict.csv 放到 data/ 下）`)
  process.exit(1)
}

/** 逐行扫描 CSV（正确处理引号内的逗号/换行）。 */
function forEachRow(text, cb) {
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      cb(row)
      row = []
      field = ''
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field.length || row.length) {
    row.push(field)
    cb(row)
  }
}

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\r?\n/g, '\\n')

const SINGLE = /^[A-Za-z][A-Za-z'\-]*$/
const forms = new Map() // form(lower) → lemma(lower)
const bases = [] // { w, ph, pos, en, zh, tag, c, o, bnc, frq }

const text = readFileSync(CSV, 'utf8')
let rowNo = 0
forEachRow(text, (row) => {
  rowNo++
  if (rowNo === 1) return // 表头
  const [word, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq, exchange] = row
  const w = (word ?? '').trim()
  if (!w || !SINGLE.test(w)) return

  // 解析 exchange：p过去式 d过去分词 i现在分词 3三单 s复数 r比较级 t最高级 0/1 原型
  const ex = {}
  for (const part of (exchange ?? '').split('/')) {
    const [k, v] = part.split(':')
    if (k && v) ex[k] = v
  }
  const lower = w.toLowerCase()
  // 原型：有 0/1 用它，否则自己就是原型
  const lemma = (ex['0'] || ex['1'] || w).toLowerCase()
  if (lemma !== lower) forms.set(lower, lemma)
  // 以原型为准，把它的各种词形都映射回原型
  for (const k of ['p', 'd', 'i', '3', 's', 'r', 't']) {
    const f = ex[k]
    if (f) forms.set(String(f).toLowerCase(), lemma)
  }

  // 只保留原型行（其余行只用于 forms 映射）
  if (lemma !== lower) return

  // 过滤：只留"常用词"（有分级标签 / 柯林斯星级 / 牛津3000 / 高频）
  const c = Number(collins || 0)
  const o = oxford === '1'
  const b = Number(bnc || 0)
  const fq = Number(frq || 0)
  const common = (tag ?? '').trim() !== '' || c >= 1 || o || (b > 0 && b <= 60000) || (fq > 0 && fq <= 60000)
  if (!common) return

  bases.push({ w, ph: phonetic, pos, en: definition, zh: translation, tag, c, o: o ? 1 : 0, bnc: b, frq: fq })
})

mkdirSync('public', { recursive: true })

const head = 'word\tphonetic\tpos\ten\tzh\ttag\tcollins\toxford\tbnc\tfrq\n'
const body = bases
  .map((b) =>
    [b.w, b.ph, b.pos, b.en, b.zh, b.tag, b.c, b.o, b.bnc, b.frq].map(esc).join('\t'),
  )
  .join('\n')
writeFileSync('public/ecdict.tsv', head + body + '\n', 'utf8')

const formsBody = [...forms.entries()].map(([f, l]) => `${f}\t${l}`).join('\n')
writeFileSync('public/ecdict-forms.tsv', formsBody + '\n', 'utf8')

console.log(`词条（常用词）: ${bases.length}`)
console.log(`词形→原型: ${forms.size}`)
console.log('已写入 public/ecdict.tsv 与 public/ecdict-forms.tsv')
