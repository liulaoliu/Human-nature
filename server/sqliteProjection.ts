/**
 * 派生投影：把 `vocab` / `articles` 的 JSON payload 摊到可查询的关系表里。
 *
 * 为什么单独一层：事实来源永远是 JSON payload，派生表只是「同一次事务里重建的副本」。
 * 重建逻辑（含旧库迁移时的 `normalizeLegacySourceIds`）有 130 行、全是 db 语句，
 * 混在 `openStore` 的方法群里很难看出「哪些是事实、哪些是投影」。
 *
 * 这里只接 `db`、不持有连接、不管事务——事务由调用方（sqliteStore）包。
 */
import type { DatabaseSync } from 'node:sqlite'
import { list, nowIso, num, text } from './sqliteUtil.ts'
import { rebuildVocabProjection } from './sqliteVocab.ts'
import { isRecord, asRecord } from './types/guards.ts'

// JSON.parse 的产物形状不可信，交给调用侧守卫；这里只做「字符串 → JSON」，
// 返回 unknown，由下游 rebuild* / normalize 统一收窄。
const parsePayload = (payload: unknown): unknown => JSON.parse(String(payload))

/** 删一篇文章的全部派生行（按外键顺序，先删词条再删挂靠表）。 */
export function deleteArticleProjection(db: DatabaseSync, articleId: string): void {
  db.prepare(
    'DELETE FROM lang_point_terms WHERE lang_point_id IN (SELECT id FROM lang_points WHERE article_id = ?)',
  ).run(articleId)
  for (const table of [
    'lang_points',
    'article_collocations',
    'article_sentence_vocab',
    'article_sentence_tags',
    'article_sentences',
    'article_paragraph_sentences',
    'article_paragraphs',
  ]) {
    db.prepare(`DELETE FROM ${table} WHERE article_id = ?`).run(articleId)
  }
}

/** 文章 JSON → article_sentences / lang_points / ... 派生表。 */
export function rebuildArticleProjection(db: DatabaseSync, article: unknown): void {
  // article 是 articles.payload 的 parse 结果；saveArticle 已保证它是对象，
  // 这里仍用 asRecord 兜底（.id 不存在时走空串，与原 String(article.id) 对齐）。
  const art = asRecord(article)
  const articleId = String(art?.id)
  deleteArticleProjection(db, articleId)

  const insertParagraph = db.prepare(
    'INSERT INTO article_paragraphs (article_id, id, ordinal) VALUES (?, ?, ?)',
  )
  const insertParagraphSentence = db.prepare(
    'INSERT INTO article_paragraph_sentences (article_id, paragraph_id, sentence_id, ordinal) VALUES (?, ?, ?, ?)',
  )
  list<unknown>(art?.paragraphs).forEach((p, pi) => {
    if (!isRecord(p)) return
    const pid = text(p.id) ?? `p${pi + 1}`
    insertParagraph.run(articleId, pid, pi)
    list<unknown>(p.sentenceIds).forEach((sid, si) =>
      insertParagraphSentence.run(articleId, pid, text(sid) ?? '', si),
    )
  })

  const insertSentence = db.prepare(`
    INSERT OR REPLACE INTO article_sentences (
      article_id, id, para_id, ordinal, text, audio_start, audio_end, translation, grammar_note,
      review_ease, review_due, review_interval, review_repetitions, review_lapses
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertCollocation = db.prepare(
    'INSERT INTO article_collocations (article_id, sentence_id, ordinal, text) VALUES (?, ?, ?, ?)',
  )
  const insertVocab = db.prepare(
    'INSERT INTO article_sentence_vocab (article_id, sentence_id, ordinal, word) VALUES (?, ?, ?, ?)',
  )
  const insertTag = db.prepare(
    'INSERT INTO article_sentence_tags (article_id, sentence_id, ordinal, text) VALUES (?, ?, ?, ?)',
  )
  const insertLang = db.prepare(
    'INSERT INTO lang_points (id, article_id, sentence_id, ordinal, source, structure, grammar, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
  const insertTerm = db.prepare(
    'INSERT INTO lang_point_terms (lang_point_id, kind, ordinal, text) VALUES (?, ?, ?, ?)',
  )

  list<unknown>(art?.sentences).forEach((s, si) => {
    if (!isRecord(s)) return
    const sid = text(s.id) ?? `s${si + 1}`
    // reviewState 只认对象（数组也放行，读字段全是 undefined），与原判断一致。
    const review = asRecord(s.reviewState) ?? {}
    const audio = asRecord(s.audio)
    insertSentence.run(
      articleId,
      sid,
      text(s.paraId) ?? '',
      si,
      text(s.text) ?? '',
      audio ? num(audio.start, 0) : null,
      audio ? num(audio.end, 0) : null,
      text(s.translation),
      text(s.grammarNote),
      num(review.ease, 2.5),
      text(review.due),
      num(review.interval),
      num(review.repetitions),
      num(review.lapses),
    )
    list<unknown>(s.collocations).forEach((v, i) => insertCollocation.run(articleId, sid, i, text(v) ?? ''))
    list<unknown>(s.vocab).forEach((v, i) => insertVocab.run(articleId, sid, i, text(v) ?? ''))
    list<unknown>(s.tags).forEach((v, i) => insertTag.run(articleId, sid, i, text(v) ?? ''))

    // languages 数组优先；老数据可能只有单对象 language 字段，兜成单元素数组。
    const langs = list<unknown>(s.languages).length > 0
      ? list<unknown>(s.languages)
      : isRecord(s.language) ? [s.language] : []
    langs.forEach((L, li) => {
      if (!isRecord(L)) return
      const lpId = `${articleId}:${sid}:lang:${li}`
      insertLang.run(
        lpId,
        articleId,
        sid,
        li,
        text(L.source) ?? 'ai',
        text(L.structure),
        text(L.grammar),
        text(L.at),
      )
      for (const [kind, values] of Object.entries({
        idiom: L.idioms,
        phrase: L.phrases,
        usage: L.usage,
      })) {
        list<unknown>(values).forEach((v, i) => insertTerm.run(lpId, kind, i, text(v) ?? ''))
      }
    })
  })
}

/** 全库重建（迁移用）：词库 + 所有文章。 */
export function rebuildAllProjections(db: DatabaseSync): void {
  const row = db.prepare('SELECT payload FROM vocab WHERE id = 1').get()
  rebuildVocabProjection(db, row ? parsePayload(row.payload) : null)
  for (const a of db.prepare('SELECT payload FROM articles').all()) {
    rebuildArticleProjection(db, parsePayload(a.payload))
  }
}

/**
 * v4：早期词条的 `source.articleId` 存的是文章标题（不是 `saved:…` id）。
 * 重新切句后按标题还能唯一对上，就一次性换成真正的文章 id；
 * 结构相同的 `examples[].articleId` / `contexts[].articleId` 一起换。
 *
 * 只改能唯一对上的标题；同名文章、找不到的标题保持原样，不猜。
 */
export function normalizeLegacySourceIds(db: DatabaseSync): void {
  const byTitle = new Map<string, string | null>()
  for (const r of db.prepare('SELECT id, title FROM articles').all()) {
    const title = text(r.title)
    if (!title) continue
    // 同名文章不猜：置空后下面会跳过。
    if (byTitle.has(title)) byTitle.set(title, null)
    else byTitle.set(title, String(r.id))
  }
  if (!byTitle.size) return

  const row = db.prepare('SELECT payload FROM vocab WHERE id = 1').get()
  if (!row) return
  const lib = parsePayload(row.payload)
  let changed = false
  const mapId = (v: unknown): unknown => {
    const s = text(v)
    if (!s) return v
    const id = byTitle.get(s)
    if (!id) return v
    changed = true
    return id
  }

  for (const item of list<unknown>(asRecord(lib)?.items)) {
    if (!isRecord(item)) continue
    const source = asRecord(item.source)
    if (source) {
      // 直接改 parse 出来的对象（同一引用），最后 JSON.stringify 回写；
      // 与旧代码逐字段赋值的行为一致。
      source.articleId = mapId(source.articleId)
    }
    for (const ex of list<unknown>(item.examples)) {
      if (isRecord(ex)) ex.articleId = mapId(ex.articleId)
    }
    for (const ctx of list<unknown>(item.contexts)) {
      if (isRecord(ctx)) ctx.articleId = mapId(ctx.articleId)
    }
  }

  if (!changed) return
  db.prepare('UPDATE vocab SET payload = ?, updated_at = ? WHERE id = 1').run(
    JSON.stringify(lib),
    nowIso(),
  )
  rebuildVocabProjection(db, lib)
}

/** 覆盖/删除文章前，把当前版本留到 article_prev（一篇文章只留一版）。 */
export function rememberArticlePrev(db: DatabaseSync, id: string, nextPayload?: string): boolean {
  const row = db.prepare('SELECT payload, title, updated_at FROM articles WHERE id = ?').get(String(id))
  if (!row) return false
  if (nextPayload !== undefined && String(row.payload) === String(nextPayload)) return false
  db.prepare(
    'INSERT OR REPLACE INTO article_prev (article_id, payload, title, updated_at) VALUES (?, ?, ?, ?)',
  ).run(String(id), String(row.payload), String(row.title ?? ''), String(row.updated_at))
  return true
}
