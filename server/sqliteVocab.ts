import type { DatabaseSync, StatementSync } from 'node:sqlite'
import { list, nowIso, num, text } from './sqliteUtil.ts'
import { isRecord, asRecord } from './types/guards.ts'

/**
 * 词库 JSON → words / word_* 派生表。
 *
 * 事实来源仍是 `vocab.payload`；这里只负责派生表，必须由调用方放在写事务里。
 * 传 `prevLib` 时走**增量**：只有新增 / 内容变化 / 删除的词条会动派生表；
 * 未变化的词条保留原 rowid，避免每次自动补全/评分都全量 delete + insert。
 * 不传（迁移、清空）则全量重建。
 */

const WORD_CHILD_TABLES = [
  'word_usage',
  'word_phrases',
  'word_idioms',
  'word_tags',
  'word_grammar_marks',
  'word_examples',
  'word_contexts',
  'word_confusables',
]

// ---- JSON 边界守卫在 ./types/guards.ts（与 sqliteProjection 等共用）----
// lib / prevLib 是 vocab.payload 的 JSON.parse 结果，到这里形状不可信。
// 字段读取统一先收窄成 record：坏形状按「没有该字段」处理（undefined），
// 与旧代码里 `it.x?.y` 对非对象静默得 undefined 的行为逐位一致。
// 数据来源：SQLite vocab.payload（TEXT 列）；失败行为 = 字段为空，不抛错。

/** items 数组里的非对象条目（含 null）照旧过滤掉，不进派生表。 */
function itemsOf(lib: unknown): Record<string, unknown>[] {
  return list<unknown>(asRecord(lib)?.items).filter(isRecord)
}

function clearWordProjection(db: DatabaseSync): void {
  for (const t of WORD_CHILD_TABLES) db.prepare(`DELETE FROM ${t}`).run()
  db.prepare('DELETE FROM words').run()
}

/** 按 id 删一组词条（words + 派生表）；分块避免超过 SQLite 参数上限。 */
function deleteWordIds(db: DatabaseSync, ids: string[]): void {
  if (!ids.length) return
  for (let start = 0; start < ids.length; start += 500) {
    const chunk = ids.slice(start, start + 500)
    const ph = chunk.map(() => '?').join(',')
    for (const t of WORD_CHILD_TABLES) db.prepare(`DELETE FROM ${t} WHERE word_id IN (${ph})`).run(...chunk)
    db.prepare(`DELETE FROM words WHERE id IN (${ph})`).run(...chunk)
  }
}

const wordIdOf = (it: Record<string, unknown>, i: number): string =>
  text(it.id) ?? `${text(it.lemma) ?? text(it.word) ?? 'word'}:${i}`

export function rebuildVocabProjection(db: DatabaseSync, lib: unknown, prevLib?: unknown): void {
  const items = itemsOf(lib)
  const incremental = prevLib !== undefined && lib != null
  /** 需要重写的 id；null = 全量。 */
  let writeIds: Set<string> | null = null

  if (incremental) {
    const prevById = new Map<string, string>(
      itemsOf(prevLib).map((it, i) => [wordIdOf(it, i), JSON.stringify(it)]),
    )
    const nextById = new Map<string, string>(items.map((it, i) => [wordIdOf(it, i), JSON.stringify(it)]))
    writeIds = new Set<string>()
    for (const [id, json] of nextById) {
      if (prevById.get(id) !== json) writeIds.add(id)
    }
    const removed = [...prevById.keys()].filter((id) => !nextById.has(id))
    deleteWordIds(db, [...writeIds, ...removed])
  } else {
    clearWordProjection(db)
  }

  if (!items.length) return

  const insertWord = db.prepare(`
    INSERT OR REPLACE INTO words (
      id, word, lemma, kind, lang_point_id, phonetic, part_of_speech, meaning, definition,
      status, note, source_article_id, source_file_name, source_sentence_id, source_sentence_text,
      review_ease, review_due, review_interval, review_repetitions, review_lapses,
      last_printed_at, priority_until, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertText: Record<string, StatementSync> = {
    word_usage: db.prepare('INSERT INTO word_usage (word_id, ordinal, text) VALUES (?, ?, ?)'),
    word_phrases: db.prepare('INSERT INTO word_phrases (word_id, ordinal, text) VALUES (?, ?, ?)'),
    word_idioms: db.prepare('INSERT INTO word_idioms (word_id, ordinal, text) VALUES (?, ?, ?)'),
    word_tags: db.prepare('INSERT INTO word_tags (word_id, ordinal, text) VALUES (?, ?, ?)'),
    word_grammar_marks: db.prepare('INSERT INTO word_grammar_marks (word_id, ordinal, text) VALUES (?, ?, ?)'),
  }
  const insertExample = db.prepare(`
    INSERT INTO word_examples (word_id, ordinal, text, translation, article_id, file_name, sentence_id, origin)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertContext = db.prepare(`
    INSERT INTO word_contexts (word_id, ordinal, article_id, file_name, sentence_id, sentence_text, meaning, at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertConfusable = db.prepare(
    'INSERT INTO word_confusables (word_id, ordinal, word, meaning) VALUES (?, ?, ?, ?)',
  )

  items.forEach((it, i) => {
    const id = wordIdOf(it, i)
    if (writeIds && !writeIds.has(id)) return
    // reviewState 只认对象；数组当 record 读字段全是 undefined，行为与旧代码
    // 的 `typeof === 'object'` 判断一致（数组同样放行、同样读不到字段）。
    const review = asRecord(it.reviewState) ?? {}
    const source = asRecord(it.source)
    insertWord.run(
      id,
      text(it.word) ?? '',
      text(it.lemma) ?? text(it.word) ?? '',
      text(it.kind) ?? 'word',
      text(it.langPointId),
      text(it.phonetic),
      text(it.partOfSpeech),
      text(it.meaning),
      text(it.definition),
      text(it.status) ?? 'unqueried',
      text(it.note) ?? '',
      text(source?.articleId),
      text(source?.fileName),
      text(source?.sentenceId),
      text(source?.sentenceText),
      num(review.ease, 2.5),
      text(review.due),
      num(review.interval),
      num(review.repetitions),
      num(review.lapses),
      text(it.lastPrintedAt),
      text(it.priorityUntil),
      text(it.createdAt) ?? nowIso(),
      text(it.updatedAt) ?? nowIso(),
    )

    for (const [table, values] of Object.entries({
      word_usage: it.usage,
      word_phrases: it.phrases,
      word_idioms: it.idioms,
      word_tags: it.tags,
      word_grammar_marks: it.grammarMarks,
    })) {
      // 上面字面量的键与 insertText 完全一致，判空只为满足
      // noUncheckedIndexedAccess 的静态检查，运行时不会走到 continue。
      const stmt = insertText[table]
      if (!stmt) continue
      list<unknown>(values).forEach((value, ordinal) => stmt.run(id, ordinal, text(value) ?? ''))
    }

    list<unknown>(it.examples).forEach((ex, ordinal) => {
      if (!isRecord(ex)) return
      insertExample.run(
        id,
        ordinal,
        text(ex.text) ?? '',
        text(ex.translation),
        text(ex.articleId),
        text(ex.fileName),
        text(ex.sentenceId),
        text(ex.origin),
      )
    })
    list<unknown>(it.contexts).forEach((ctx, ordinal) => {
      if (!isRecord(ctx)) return
      insertContext.run(
        id,
        ordinal,
        text(ctx.articleId) ?? '',
        text(ctx.fileName),
        text(ctx.sentenceId),
        text(ctx.sentenceText) ?? '',
        text(ctx.meaning),
        text(ctx.at) ?? nowIso(),
      )
    })
    list<unknown>(it.confusables).forEach((c, ordinal) => {
      if (!isRecord(c)) return
      insertConfusable.run(id, ordinal, text(c.word) ?? '', text(c.meaning))
    })
  })
}
