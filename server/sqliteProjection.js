/**
 * 派生投影：把 `vocab` / `articles` 的 JSON payload 摊到可查询的关系表里。
 *
 * 为什么单独一层：事实来源永远是 JSON payload，派生表只是「同一次事务里重建的副本」。
 * 重建逻辑（含旧库迁移时的 `normalizeLegacySourceIds`）有 130 行、全是 db 语句，
 * 混在 `openStore` 的方法群里很难看出「哪些是事实、哪些是投影」。
 *
 * 这里只接 `db`、不持有连接、不管事务——事务由调用方（sqliteStore）包。
 */
import { list, nowIso, num, text } from './sqliteUtil.js'
import { rebuildVocabProjection } from './sqliteVocab.js'

const parsePayload = (payload) => JSON.parse(String(payload))

/** 删一篇文章的全部派生行（按外键顺序，先删词条再删挂靠表）。 */
export function deleteArticleProjection(db, articleId) {
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
export function rebuildArticleProjection(db, article) {
  const articleId = String(article.id)
  deleteArticleProjection(db, articleId)

  const insertParagraph = db.prepare(
    'INSERT INTO article_paragraphs (article_id, id, ordinal) VALUES (?, ?, ?)',
  )
  const insertParagraphSentence = db.prepare(
    'INSERT INTO article_paragraph_sentences (article_id, paragraph_id, sentence_id, ordinal) VALUES (?, ?, ?, ?)',
  )
  list(article.paragraphs).forEach((p, pi) => {
    if (!p || typeof p !== 'object') return
    const pid = text(p.id) ?? `p${pi + 1}`
    insertParagraph.run(articleId, pid, pi)
    list(p.sentenceIds).forEach((sid, si) =>
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

  list(article.sentences).forEach((s, si) => {
    if (!s || typeof s !== 'object') return
    const sid = text(s.id) ?? `s${si + 1}`
    const review = s.reviewState && typeof s.reviewState === 'object' ? s.reviewState : {}
    insertSentence.run(
      articleId,
      sid,
      text(s.paraId) ?? '',
      si,
      text(s.text) ?? '',
      s.audio ? num(s.audio.start, 0) : null,
      s.audio ? num(s.audio.end, 0) : null,
      text(s.translation),
      text(s.grammarNote),
      num(review.ease, 2.5),
      text(review.due),
      num(review.interval),
      num(review.repetitions),
      num(review.lapses),
    )
    list(s.collocations).forEach((v, i) => insertCollocation.run(articleId, sid, i, text(v) ?? ''))
    list(s.vocab).forEach((v, i) => insertVocab.run(articleId, sid, i, text(v) ?? ''))
    list(s.tags).forEach((v, i) => insertTag.run(articleId, sid, i, text(v) ?? ''))

    const langs =
      list(s.languages).length > 0 ? list(s.languages) : s.language && typeof s.language === 'object' ? [s.language] : []
    langs.forEach((L, li) => {
      if (!L || typeof L !== 'object') return
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
        list(values).forEach((v, i) => insertTerm.run(lpId, kind, i, text(v) ?? ''))
      }
    })
  })
}

/** 全库重建（迁移用）：词库 + 所有文章。 */
export function rebuildAllProjections(db) {
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
export function normalizeLegacySourceIds(db) {
  const byTitle = new Map()
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
  const mapId = (v) => {
    const s = text(v)
    if (!s) return v
    const id = byTitle.get(s)
    if (!id) return v
    changed = true
    return id
  }

  for (const item of list(lib?.items)) {
    if (!item || typeof item !== 'object') continue
    if (item.source && typeof item.source === 'object') {
      item.source.articleId = mapId(item.source.articleId)
    }
    for (const ex of list(item.examples)) {
      if (ex && typeof ex === 'object') ex.articleId = mapId(ex.articleId)
    }
    for (const ctx of list(item.contexts)) {
      if (ctx && typeof ctx === 'object') ctx.articleId = mapId(ctx.articleId)
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
export function rememberArticlePrev(db, id, nextPayload) {
  const row = db.prepare('SELECT payload, title, updated_at FROM articles WHERE id = ?').get(String(id))
  if (!row) return false
  if (nextPayload !== undefined && String(row.payload) === String(nextPayload)) return false
  db.prepare(
    'INSERT OR REPLACE INTO article_prev (article_id, payload, title, updated_at) VALUES (?, ?, ?, ?)',
  ).run(String(id), String(row.payload), String(row.title ?? ''), String(row.updated_at))
  return true
}
