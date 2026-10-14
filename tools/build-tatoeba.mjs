#!/usr/bin/env node
/**
 * build-tatoeba.mjs —— 把 Tatoeba 的「英文 + 中文」句对做成离线例句表：
 *   public/tatoeba-en.tsv       word \t 英文句 \t 中文句
 *
 * 数据来源：https://tatoeba.org/en/downloads （CC BY 2.0 FR，请保留来源署名）
 *   需要两个文件：
 *     sentences.csv   （sentences.tar.bz2 解出；字段：id \t lang \t text）
 *     links.csv       （links.tar.bz2 解出；字段：id1 \t id2）
 *
 * 用法（解压后）：
 *   node tools/build-tatoeba.mjs data/sentences.csv data/links.csv [目标语言=cmn]
 *
 * 说明：
 *   - 只保留 en → cmn 互译的句对；
 *   - 按「英文句里出现的每个词」建索引（小写、去标点、长度 ≥ 3）；
 *   - 每个词最多留 4 条，优先**短句**（更适合当例句）；
 *   - 输出 TSV，制表/换行会转成空格。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const [, , sentencesPath = 'data/sentences.csv', linksPath = 'data/links.csv', tgt = 'cmn'] = process.argv
if (!existsSync(sentencesPath) || !existsSync(linksPath)) {
  console.error(`找不到输入文件：\n  ${sentencesPath}\n  ${linksPath}\n用法：node tools/build-tatoeba.mjs <sentences.csv> <links.csv> [cmn]`)
  process.exit(1)
}

const MAX_PER_WORD = 4
const MAX_EN_LEN = 90 // 太长的例句不要
const MIN_WORD_LEN = 3

/** id → { lang, text }（只留 en 与目标语言，省内存）。 */
const sentences = new Map()
for (const line of readFileSync(sentencesPath, 'utf8').split('\n')) {
  if (!line) continue
  const f = line.split('\t')
  const lang = f[1]
  if (lang !== 'en' && lang !== tgt) continue
  const text = (f[2] ?? '').trim()
  if (!text) continue
  sentences.set(f[0], { lang, text })
}

/** en ↔ tgt 句对。 */
const pairs = []
for (const line of readFileSync(linksPath, 'utf8').split('\n')) {
  if (!line) continue
  const [a, b] = line.split('\t')
  const A = sentences.get(a)
  const B = sentences.get(b)
  if (!A || !B) continue
  if (A.lang === 'en' && B.lang === tgt) pairs.push([A.text, B.text])
  else if (A.lang === tgt && B.lang === 'en') pairs.push([B.text, A.text])
}

const clean = (s) => s.replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()

/** word → 例句列表（短的优先）。 */
const byWord = new Map()
for (const [enRaw, zhRaw] of pairs) {
  const en = clean(enRaw)
  const zh = clean(zhRaw)
  if (!en || !zh || en.length > MAX_EN_LEN) continue
  const words = new Set(
    en
      .toLowerCase()
      .replace(/[^a-z'\- ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= MIN_WORD_LEN),
  )
  for (const w of words) {
    let arr = byWord.get(w)
    if (!arr) {
      arr = []
      byWord.set(w, arr)
    }
    if (arr.length >= MAX_PER_WORD) continue
    if (arr.some((x) => x.en === en)) continue
    arr.push({ en, zh })
  }
}

const lines = []
for (const [w, arr] of byWord) {
  // 短的优先（同样是短句，更像好例句）
  arr.sort((a, b) => a.en.length - b.en.length)
  for (const { en, zh } of arr) lines.push(`${w}\t${en}\t${zh}`)
}
writeFileSync('public/tatoeba-en.tsv', lines.join('\n') + '\n', 'utf8')
console.log(`Tatoeba 例句：${pairs.length} 个句对 → 覆盖 ${byWord.size} 个词，共 ${lines.length} 行`)
console.log('→ public/tatoeba-en.tsv（记得在界面上保留 Tatoeba / CC BY 2.0 FR 署名）')
