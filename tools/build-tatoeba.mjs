#!/usr/bin/env node
/**
 * build-tatoeba.mjs —— 把 Tatoeba 的「英文 + 中文」句对做成离线例句表：
 *   public/tatoeba-en.tsv       word \t 英文句 \t 中文句
 *
 * 数据来源：https://tatoeba.org/en/downloads （CC BY 2.0 FR，请保留来源署名）
 * 最省事的下法（按语言对导出，最小）：
 *   https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2
 *   https://downloads.tatoeba.org/exports/per_language/cmn/cmn_sentences.tsv.bz2
 *   https://downloads.tatoeba.org/exports/per_language/eng/eng-cmn_links.tsv.bz2
 *   解压后把两个 sentences 文件按 id→lang→text 合并成一个即可（拼接即可）。
 *
 * 用法：
 *   node tools/build-tatoeba.mjs <sentences.tsv> <links.tsv> [目标语言=cmn]
 *   （sentences.tsv 字段：id \t lang \t text ；links.tsv 字段：id1 \t id2）
 *
 * 说明：
 *   - 只保留 en ↔ 目标语言 互译的句对；
 *   - 按「英文句里出现的每个词」建索引（小写、去标点、长度 ≥ 3）；
 *   - 每个词最多留 4 条，优先**短句**；
 *   - 输出 TSV，制表/换行会转成空格。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const [, , sentencesPath = 'data/sentences.tsv', linksPath = 'data/links.tsv', tgtArg = 'cmn'] = process.argv
if (!existsSync(sentencesPath) || !existsSync(linksPath)) {
  console.error(
    `找不到输入文件：\n  ${sentencesPath}\n  ${linksPath}\n用法：node tools/build-tatoeba.mjs <sentences.tsv> <links.tsv> [cmn]`,
  )
  process.exit(1)
}

const MAX_PER_WORD = 4
const MAX_EN_LEN = 90 // 太长的例句不要
const MIN_WORD_LEN = 3
/** `--en-only`：给**没有中译例句**的词补纯英文短句（针对高级词）。 */
const EN_ONLY = process.argv.includes('--en-only')
const EN_ONLY_MAX = 2
const EN_ONLY_LEN = 60
const EN_ONLY_MIN_WORD = 4

/** Tatoeba 用 ISO 639-3（eng/cmn）；这里两种码都认。 */
const tgt = tgtArg === 'zh' || tgtArg === 'zho' ? 'cmn' : tgtArg
const isEn = (l) => l === 'en' || l === 'eng'
const isTgt = (l) => l === tgt

// 先读 links：拿到需要翻译的句子 id（避免把 200 万句英文全读进内存）
const links = []
const need = new Set()
for (const line of readFileSync(linksPath, 'utf8').split('\n')) {
  if (!line) continue
  const f = line.split('\t')
  if (f.length < 2 || !f[0] || !f[1]) continue
  links.push([f[0], f[1]])
  need.add(f[0])
  need.add(f[1])
}

// 再读 sentences：只留 links 里用到的 id
const sentences = new Map()
for (const line of readFileSync(sentencesPath, 'utf8').split('\n')) {
  if (!line) continue
  const i1 = line.indexOf('\t')
  if (i1 < 0) continue
  const id = line.slice(0, i1)
  if (!need.has(id)) continue
  const i2 = line.indexOf('\t', i1 + 1)
  const lang = i2 < 0 ? line.slice(i1 + 1) : line.slice(i1 + 1, i2)
  const text = i2 < 0 ? '' : line.slice(i2 + 1)
  if (!text.trim()) continue
  if (isEn(lang)) sentences.set(id, { lang: 'en', text })
  else if (isTgt(lang)) sentences.set(id, { lang: tgt, text })
}

// en ↔ tgt 句对
const pairs = []
for (const [a, b] of links) {
  const A = sentences.get(a)
  const B = sentences.get(b)
  if (!A || !B) continue
  if (A.lang === 'en' && B.lang === tgt) pairs.push([A.text, B.text])
  else if (A.lang === tgt && B.lang === 'en') pairs.push([B.text, A.text])
}

const clean = (s) => s.replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()

/** word → 例句列表 */
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

/** 从一行 `id \t lang \t text` 里取 { id, lang, text }。 */
function splitLine(line) {
  const i1 = line.indexOf('\t')
  if (i1 < 0) return null
  const i2 = line.indexOf('\t', i1 + 1)
  const id = line.slice(0, i1)
  const lang = i2 < 0 ? line.slice(i1 + 1) : line.slice(i1 + 1, i2)
  const text = i2 < 0 ? '' : line.slice(i2 + 1)
  return { id, lang, text }
}

/** 英文短句里的词（小写、去标点）。 */
function wordsOf(en, minLen = MIN_WORD_LEN) {
  return new Set(
    en
      .toLowerCase()
      .replace(/[^a-z'\- ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= minLen),
  )
}

// 可选：给「没有中译例句」的词补纯英文短句（高级词在 Tatoeba 大多只有纯英文句）
if (EN_ONLY) {
  for (const line of readFileSync(sentencesPath, 'utf8').split('\n')) {
    if (!line) continue
    const s = splitLine(line)
    if (!s || !isEn(s.lang)) continue
    const en = clean(s.text)
    if (!en || en.length > EN_ONLY_LEN) continue
    for (const w of wordsOf(en, EN_ONLY_MIN_WORD)) {
      const arr = byWord.get(w)
      if (arr && arr.some((x) => x.zh)) continue // 已有中译例句的词不补
      if (arr && arr.length >= EN_ONLY_MAX) continue
      if (arr && arr.some((x) => x.en === en)) continue
      if (arr) arr.push({ en, zh: '' })
      else byWord.set(w, [{ en, zh: '' }])
    }
  }
}

const lines = []
for (const [w, arr] of byWord) {
  arr.sort((a, b) => a.en.length - b.en.length) // 短句优先
  for (const { en, zh } of arr) lines.push(`${w}\t${en}\t${zh}`)
}
writeFileSync('public/tatoeba-en.tsv', lines.join('\n') + '\n', 'utf8')
console.log(`Tatoeba 例句：${pairs.length} 个句对 → 覆盖 ${byWord.size} 个词，共 ${lines.length} 行`)
console.log('→ public/tatoeba-en.tsv（记得在界面上保留 Tatoeba / CC BY 2.0 FR 署名）')
