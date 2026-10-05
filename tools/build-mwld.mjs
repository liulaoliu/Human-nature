#!/usr/bin/env node
/**
 * build-mwld.mjs —— 把 anki-english-mwld-decks 的 notes.csv（Tab 分隔，HTML）
 * 预处理成 public/mwld.tsv：word \t phonetic \t pos \t en
 *
 * 每词多义按 core → extend → rare 排序，取前 3 个英文释义合并（M-W 学习者词典）。
 * 用法：node tools/build-mwld.mjs [notes.csv]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const CSV =
  process.argv[2] ||
  'data/anki-english-mwld-decks-main/anki-english-mwld-decks-main/deck-source/notes.csv'
if (!existsSync(CSV)) {
  console.error(`找不到 ${CSV}`)
  process.exit(1)
}

const strip = (s) =>
  String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const rank = (tags) => (tags.includes('::core') ? 0 : tags.includes('::extend') ? 1 : 2)

/** lower(word) → { phonetic, pos, senses:[{r,en}] } */
const map = new Map()
const text = readFileSync(CSV, 'utf8')
for (const line of text.split('\n')) {
  if (!line || line.startsWith('#')) continue
  const f = line.split('\t')
  if (f.length < 20) continue
  const word = (f[4] ?? '').trim()
  if (!word || !/^[A-Za-z][A-Za-z'\- ]*$/.test(word)) continue
  const pos = strip(f[5])
  const phonetic = strip(f[6])
  const en = strip(f[9])
  if (!en) continue
  const lower = word.toLowerCase()
  let rec = map.get(lower)
  if (!rec) {
    rec = { word, phonetic: '', pos: '', senses: [] }
    map.set(lower, rec)
  }
  if (!rec.phonetic && phonetic) rec.phonetic = phonetic
  if (!rec.pos && pos) rec.pos = pos
  rec.senses.push({ r: rank(f[19] ?? ''), en })
}

const lines = []
for (const rec of map.values()) {
  const senses = [...new Set(rec.senses.sort((a, b) => a.r - b.r).map((s) => s.en))].slice(0, 3)
  const en = senses.join('; ').slice(0, 300)
  // 制表/换行转义
  const esc = (s) => s.replace(/\t/g, ' ').replace(/[\r\n]+/g, ' ').trim()
  lines.push([rec.word, rec.phonetic, rec.pos, en].map(esc).join('\t'))
}
writeFileSync('public/mwld.tsv', lines.join('\n') + '\n', 'utf8')
console.log(`M-W 词条: ${lines.length} → public/mwld.tsv`)
