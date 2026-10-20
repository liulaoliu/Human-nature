import { chmodSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import {
  SCHEMA_V1,
  SCHEMA_V2,
  SCHEMA_V3,
  SCHEMA_V5,
  SCHEMA_V6,
  SCHEMA_V7,
  SCHEMA_VERSION,
} from './sqliteSchema.js'
import { backupBeforeMigration, backupDaily, startDailyBackup } from './sqliteBackup.js'
import {
  hasLearningRows,
  LEARNING_SECTIONS,
  listLearningSnapshots,
  loadLearning,
  loadLearningSnapshot,
  rebuildLearningDerived,
  restoreLearningSnapshot,
  saveDerivedBaseline,
  writeLearning,
} from './sqliteLearning.js'
import { list, nowIso, num, text, tx } from './sqliteUtil.js'
import { rebuildVocabProjection } from './sqliteVocab.js'

/**
 * 服务端 SQLite 存储（Node 22.5+ 自带的 `node:sqlite`，不引原生 npm 包）。
 *
 * 为什么放服务端：
 *  - 浏览器 IndexedDB 按「来源」隔离、会被浏览器回收，数据在用户 Profile 深处，
 *    备份/查看/换机器都费劲；本地服务旁边的 `data/xueba.db` 是一个普通文件，能直接拷、能 SQL 查。
 *  - 仍然保留 IndexedDB 作为「没有服务 / 静态部署 / 服务挂了」时的兜底，见前端 HybridRepo。
 *
 * 数据分两层：
 *  1. `vocab` / `articles` 的 JSON payload 是**事实来源**（整库快照、回滚、导出都用它）；
 *  2. `words` / `article_sentences` / `lang_points` 等是**同一次事务里重建的派生表**，
 *     方便 SQL 查询、统计、以后做 FTS；不直接写，避免两份事实打架。
 *
 * 学习记录（v3 建表，v4 修旧 id）不同：`practice_records` / `reading_progress` / `study_word_days` 等
 * 是规范化的事实表，直接读写；偏好/会话状态不在这里，仍留在 localStorage。
 *
 * 版本迭代：用 `PRAGMA user_version` 做 schema 迁移；迁移只增不删，旧库能直接打开。
 * 安全：数据库默认 0600、目录 0700；服务只监听 127.0.0.1；写接口校验同源 Origin。
 */

const require = createRequire(import.meta.url)
let DatabaseSync = null
try {
  // Node 20 没有这个模块：不崩，返回 null，前端会自动回退 IndexedDB。
  ;({ DatabaseSync } = require('node:sqlite'))
} catch {
  // ignore
}


export { SCHEMA_VERSION } from './sqliteSchema.js'
/** 和前端 IdbVocabRepo 保持一致：留最近 8 版 + 历史最大的一版。 */
const SNAP_KEEP = 8

/** 默认放在项目 data/（已在 .gitignore 里），可用 XUEBA_DB 覆盖。 */
export function resolveDbPath(root) {
  const env = process.env.XUEBA_DB?.trim()
  return env || join(root, 'data', 'xueba.db')
}

/** 同一毫秒内连续保存时，快照主键也要唯一（否则会覆盖上一版）。 */
function nextSnapshotAt(db) {
  let at = nowIso()
  for (let i = 0; i < 100; i++) {
    const hit = db.prepare('SELECT 1 FROM vocab_snapshots WHERE at = ?').get(at)
    if (!hit) return at
    at = new Date(Date.parse(at) + 1).toISOString()
  }
  return `${at}:${Math.random().toString(36).slice(2, 8)}`
}

function parsePayload(payload) {
  return JSON.parse(payload)
}

function assertLibrary(lib) {
  if (!lib || typeof lib !== 'object' || !Array.isArray(lib.items)) {
    throw new Error('词库格式不对：缺少 items 数组')
  }
}

function addArticleColumns(db) {
  const cols = new Set(db.prepare('PRAGMA table_info(articles)').all().map((r) => String(r.name)))
  const add = (name, ddl) => {
    if (!cols.has(name)) db.exec(`ALTER TABLE articles ADD COLUMN ${ddl}`)
  }
  add('book', 'book TEXT')
  add('source_key', 'source_key TEXT')
  add('created_at', 'created_at TEXT')
  add('sentence_count', 'sentence_count INTEGER NOT NULL DEFAULT 0')
  add('word_count', 'word_count INTEGER NOT NULL DEFAULT 0')
}

/** 从 JSON payload 回填 articles 的查询列；只在迁移时做一次。 */
function backfillArticleColumns(db) {
  const rows = db.prepare('SELECT id, payload FROM articles').all()
  const upd = db.prepare(
    'UPDATE articles SET title = ?, book = ?, source_key = ?, created_at = ?, sentence_count = ?, word_count = ? WHERE id = ?',
  )
  for (const row of rows) {
    const a = parsePayload(String(row.payload))
    const sentences = list(a?.sentences)
    const words = new Set()
    for (const s of sentences) for (const w of list(s?.vocab)) words.add(String(w))
    upd.run(
      text(a?.title) ?? '',
      text(a?.book),
      text(a?.sourceKey),
      text(a?.createdAt) ?? text(a?.updatedAt) ?? nowIso(),
      sentences.length,
      words.size,
      String(row.id),
    )
  }
}

function deleteArticleProjection(db, articleId) {
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
function rebuildArticleProjection(db, article) {
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

function rebuildAllProjections(db) {
  const row = db.prepare('SELECT payload FROM vocab WHERE id = 1').get()
  rebuildVocabProjection(db, row ? parsePayload(String(row.payload)) : null)
  for (const a of db.prepare('SELECT payload FROM articles').all()) {
    rebuildArticleProjection(db, parsePayload(String(a.payload)))
  }
}

/**
 * v4：早期词条的 `source.articleId` 存的是文章标题（不是 `saved:…` id）。
 * 重新切句后按标题还能唯一对上，就一次性换成真正的文章 id；
 * 结构相同的 `examples[].articleId` / `contexts[].articleId` 一起换。
 *
 * 只改能唯一对上的标题；同名文章、找不到的标题保持原样，不猜。
 */
function normalizeLegacySourceIds(db) {
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
  const lib = parsePayload(String(row.payload))
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

function ensureSchema(db) {
  const row = db.prepare('PRAGMA user_version').get()
  let version = Number(row?.user_version ?? 0)
  if (version > SCHEMA_VERSION) {
    throw new Error(`数据库版本 ${version} 高于当前程序支持的 ${SCHEMA_VERSION}`)
  }
  if (version < 1) {
    tx(db, () => { db.exec(SCHEMA_V1); db.exec('PRAGMA user_version = 1') })
    version = 1
  }
  if (version < 2) {
    tx(db, () => {
      db.exec(SCHEMA_V2)
      addArticleColumns(db)
      backfillArticleColumns(db)
      rebuildAllProjections(db)
      db.exec('PRAGMA user_version = 2')
    })
    version = 2
  }
  if (version < 3) {
    tx(db, () => { db.exec(SCHEMA_V3); db.exec('PRAGMA user_version = 3') })
    version = 3
  }
  if (version < 4) {
    tx(db, () => { normalizeLegacySourceIds(db); db.exec('PRAGMA user_version = 4') })
    version = 4
  }
  if (version < 5) {
    tx(db, () => { db.exec(SCHEMA_V5); db.exec('PRAGMA user_version = 5') })
    version = 5
  }
  if (version < 6) {
    tx(db, () => { db.exec(SCHEMA_V6); db.exec('PRAGMA user_version = 6') })
    version = 6
  }
  if (version < 7) {
    tx(db, () => {
      db.exec(SCHEMA_V7)
      // 历史只有聚合值：先存成 baseline，之后的事件才可逐题对账/重建。
      saveDerivedBaseline(db, nowIso())
      db.exec('PRAGMA user_version = 7')
    })
    version = 7
  }
  return version
}

function pruneSnapshots(db) {
  const rows = db.prepare('SELECT at, item_count FROM vocab_snapshots ORDER BY at ASC').all()
  if (rows.length <= SNAP_KEEP + 1) return
  const keep = new Set(rows.slice(-SNAP_KEEP).map((r) => String(r.at)))
  let largest = rows[0]
  for (const r of rows) {
    if (Number(r.item_count) > Number(largest.item_count)) largest = r
  }
  if (largest) keep.add(String(largest.at))
  const del = db.prepare('DELETE FROM vocab_snapshots WHERE at = ?')
  for (const r of rows) {
    if (!keep.has(String(r.at))) del.run(String(r.at))
  }
}

function assertDatabaseHealthy(db) {
  const row = db.prepare('PRAGMA quick_check').get()
  const result = row ? Object.values(row)[0] : 'ok'
  if (String(result).toLowerCase() !== 'ok') {
    throw new Error(`SQLite 完整性检查未通过：${String(result)}`)
  }
}

/** 覆盖/删除文章前，把当前版本留到 article_prev（一篇文章只留一版）。 */
function rememberArticlePrev(db, id, nextPayload) {
  const row = db.prepare('SELECT payload, title, updated_at FROM articles WHERE id = ?').get(String(id))
  if (!row) return false
  if (nextPayload !== undefined && String(row.payload) === String(nextPayload)) return false
  db.prepare(
    'INSERT OR REPLACE INTO article_prev (article_id, payload, title, updated_at) VALUES (?, ?, ?, ?)',
  ).run(String(id), String(row.payload), String(row.title ?? ''), String(row.updated_at))
  return true
}

const cache = new Map()

/**
 * 打开（并初始化）数据库；不可用时返回 null，由 API 回 503。
 * 同一个路径复用连接，避免每个请求都重新打开。
 */
export function openStore(dbPath) {
  if (!DatabaseSync) return null
  if (cache.has(dbPath)) return cache.get(dbPath)
  try {
    const dir = dirname(dbPath)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    try {
      // 已有 data/ 可能是 775；WAL/SHM 由 SQLite 创建，靠目录权限一起保护。
      chmodSync(dir, 0o700)
    } catch {
      // Windows 忽略权限位
    }
    const db = new DatabaseSync(dbPath)
    db.exec('PRAGMA journal_mode = WAL')
    // 学习记录是用户资产：断电/系统崩溃时宁可慢一点，也别丢最后一笔提交。
    db.exec('PRAGMA synchronous = FULL')
    db.exec('PRAGMA busy_timeout = 3000')
    assertDatabaseHealthy(db)
    const currentVersion = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0)
    try {
      const backup = backupBeforeMigration(db, dbPath, currentVersion, DatabaseSync)
      if (backup) console.info(`[sqlite] 迁移前备份：${backup}`)
    } catch (e) {
      // 备份失败就不冒险迁移，让前端回退 IndexedDB，人工处理后再启动。
      throw new Error(`迁移前备份失败：${e instanceof Error ? e.message : e}`)
    }
    ensureSchema(db)
    try {
      const daily = backupDaily(db, dbPath, currentVersion, DatabaseSync)
      if (daily) console.info(`[sqlite] 每日备份：${daily}`)
    } catch (e) {
      // 每日备份失败不挡启动；迁移备份失败才挡（见上面）。
      console.warn('[sqlite] 每日备份失败：', e instanceof Error ? e.message : e)
    }
    try {
      chmodSync(dbPath, 0o600)
    } catch {
      // Windows 忽略权限位
    }
    const stopDailyBackup = startDailyBackup(db, dbPath, DatabaseSync)

    const store = {
      path: dbPath,
      db,
      close() {
        stopDailyBackup()
        try {
          db.close()
        } finally {
          cache.delete(dbPath)
        }
      },
      loadVocab() {
        const row = db.prepare('SELECT payload FROM vocab WHERE id = 1').get()
        return row ? parsePayload(String(row.payload)) : null
      },
      loadPrev() {
        const row = db.prepare('SELECT payload FROM vocab_prev WHERE id = 1').get()
        return row ? parsePayload(String(row.payload)) : null
      },
      listSnapshots() {
        return db
          .prepare('SELECT at, item_count FROM vocab_snapshots ORDER BY at DESC')
          .all()
          .map((r) => ({ at: String(r.at), count: Number(r.item_count) }))
      },
      loadSnapshot(at) {
        const row = db.prepare('SELECT payload FROM vocab_snapshots WHERE at = ?').get(String(at))
        return row ? parsePayload(String(row.payload)) : null
      },
      saveVocab(lib) {
        assertLibrary(lib)
        const at = nowIso()
        const payload = JSON.stringify(lib)
        const count = lib.items.length
        tx(db, () => {
          const prev = db.prepare('SELECT payload, item_count, updated_at FROM vocab WHERE id = 1').get()
          // 内容没变就别再全量重建派生表/写快照（自动补全 effect 重跑时很常见）。
          if (prev && String(prev.payload) === payload) return
          // 旧 payload 坏了就退回全量重建，别让一次脏数据把这次保存也拖垮。
          let prevLib
          if (prev) {
            try {
              prevLib = parsePayload(String(prev.payload))
            } catch {
              prevLib = undefined
            }
          } else {
            prevLib = null
          }
          const backup = db.prepare('SELECT item_count FROM vocab_prev WHERE id = 1').get()
          // 和前端一致：备份只留「更大的那一份」，缩水事故时保住事故前那一版。
          if (prev && Number(prev.item_count) > 0 && Number(prev.item_count) >= Number(backup?.item_count ?? 0)) {
            db.prepare(
              'INSERT OR REPLACE INTO vocab_prev (id, payload, item_count, updated_at) VALUES (1, ?, ?, ?)',
            ).run(String(prev.payload), Number(prev.item_count), String(prev.updated_at))
          }
          db.prepare(
            'INSERT OR REPLACE INTO vocab (id, payload, item_count, updated_at) VALUES (1, ?, ?, ?)',
          ).run(payload, count, at)
          db.prepare('INSERT OR REPLACE INTO vocab_snapshots (at, payload, item_count) VALUES (?, ?, ?)').run(
            nextSnapshotAt(db),
            payload,
            count,
          )
          pruneSnapshots(db)
          rebuildVocabProjection(db, lib, prevLib)
        })
      },
      /**
       * 首次从浏览器 IndexedDB 迁上来时用：只有服务端还没有词库才写入。
       * 放在一个写事务里检查，两个标签页同时迁移也不会互相覆盖。
       */
      migrateVocab(lib) {
        assertLibrary(lib)
        const at = nowIso()
        const payload = JSON.stringify(lib)
        const count = lib.items.length
        return tx(db, () => {
          const existing = db.prepare('SELECT payload FROM vocab WHERE id = 1').get()
          if (existing) return { migrated: false, value: parsePayload(String(existing.payload)) }
          db.prepare(
            'INSERT INTO vocab (id, payload, item_count, updated_at) VALUES (1, ?, ?, ?)',
          ).run(payload, count, at)
          db.prepare('INSERT OR REPLACE INTO vocab_snapshots (at, payload, item_count) VALUES (?, ?, ?)').run(
            nextSnapshotAt(db),
            payload,
            count,
          )
          rebuildVocabProjection(db, lib)
          return { migrated: true, value: lib }
        })
      },
      clearVocab() {
        tx(db, () => {
          const cur = db.prepare('SELECT payload, item_count, updated_at FROM vocab WHERE id = 1').get()
          const backup = db.prepare('SELECT item_count FROM vocab_prev WHERE id = 1').get()
          if (cur && Number(cur.item_count) > 0 && Number(cur.item_count) >= Number(backup?.item_count ?? 0)) {
            db.prepare(
              'INSERT OR REPLACE INTO vocab_prev (id, payload, item_count, updated_at) VALUES (1, ?, ?, ?)',
            ).run(String(cur.payload), Number(cur.item_count), String(cur.updated_at))
          }
          db.prepare('DELETE FROM vocab WHERE id = 1').run()
          rebuildVocabProjection(db, null)
        })
      },
      loadLearning() {
        return loadLearning(db)
      },
      listLearningSnapshots() {
        return listLearningSnapshots(db)
      },
      loadLearningSnapshot(id) {
        return loadLearningSnapshot(db, id)
      },
      restoreLearningSnapshot(id) {
        return tx(db, () => restoreLearningSnapshot(db, id))
      },
      /** 用 baseline + 答题事件重建题型聚合；活动聚合保留（不碰其它学习记录）。 */
      rebuildLearningDerived() {
        return tx(db, () => rebuildLearningDerived(db))
      },
      saveLearning(data) {
        tx(db, () => writeLearning(db, data))
      },
      /**
       * 只替换变化的 section。
       * 前端一次答题可能同时改 practice / kindStats / activity，但不会碰写作历史，
       * 所以不要为了三条练习把整份学习记录删掉重插。
       */
      saveLearningPartial(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          throw new Error('学习记录格式不对：需要对象')
        }
        const sections = Object.keys(data)
        for (const section of sections) {
          if (!LEARNING_SECTIONS.includes(section)) throw new Error(`未知学习记录 section: ${section}`)
        }
        if (!sections.length) return
        tx(db, () => writeLearning(db, data, sections))
      },
      /**
       * 首次从 localStorage 迁上来时用：只有服务端还没有任何学习记录才写入。
       * 放在一个写事务里检查，两个标签页同时迁移也不会互相覆盖。
       */
      migrateLearning(data) {
        return tx(db, () => {
          if (hasLearningRows(db)) return { migrated: false, value: loadLearning(db) }
          writeLearning(db, data)
          return { migrated: true, value: loadLearning(db) }
        })
      },
      listArticles() {
        return db
          .prepare('SELECT payload FROM articles ORDER BY updated_at DESC')
          .all()
          .map((r) => parsePayload(String(r.payload)))
      },
      getArticle(id) {
        const row = db.prepare('SELECT payload FROM articles WHERE id = ?').get(String(id))
        return row ? parsePayload(String(row.payload)) : null
      },
      saveArticle(article) {
        if (!article || typeof article !== 'object' || typeof article.id !== 'string' || !article.id) {
          throw new Error('文章格式不对：缺少 id')
        }
        const updatedAt = typeof article.updatedAt === 'string' && article.updatedAt ? article.updatedAt : nowIso()
        const createdAt = typeof article.createdAt === 'string' && article.createdAt ? article.createdAt : updatedAt
        const title = typeof article.title === 'string' ? article.title : ''
        const book = typeof article.book === 'string' ? article.book : null
        const sourceKey = typeof article.sourceKey === 'string' ? article.sourceKey : null
        const sentences = list(article.sentences)
        const words = new Set()
        for (const s of sentences) for (const w of list(s?.vocab)) words.add(String(w))
        const payload = JSON.stringify(article)
        tx(db, () => {
          rememberArticlePrev(db, article.id, payload)
          db.prepare(`
            INSERT OR REPLACE INTO articles (
              id, payload, title, book, source_key, created_at, updated_at, sentence_count, word_count
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(article.id, payload, title, book, sourceKey, createdAt, updatedAt, sentences.length, words.size)
          rebuildArticleProjection(db, article)
        })
      },
      loadArticlePrev(id) {
        const row = db.prepare('SELECT payload, updated_at FROM article_prev WHERE article_id = ?').get(String(id))
        return row
          ? { updatedAt: String(row.updated_at), value: parsePayload(String(row.payload)) }
          : null
      },
      restoreArticlePrev(id) {
        const row = db.prepare('SELECT payload FROM article_prev WHERE article_id = ?').get(String(id))
        if (!row) return null
        const value = parsePayload(String(row.payload))
        if (!value) return null
        // saveArticle 会先把当前版本存进 article_prev，恢复错了还能再切回来。
        this.saveArticle(value)
        return this.getArticle(String(id))
      },
      removeArticle(id) {
        tx(db, () => {
          rememberArticlePrev(db, String(id))
          deleteArticleProjection(db, String(id))
          db.prepare('DELETE FROM articles WHERE id = ?').run(String(id))
        })
      },
      exportAll() {
        return {
          format: 'xueba-sqlite-export',
          version: SCHEMA_VERSION,
          exportedAt: nowIso(),
          vocab: this.loadVocab(),
          vocabPrev: this.loadPrev(),
          vocabSnapshots: db
            .prepare('SELECT at, item_count, payload FROM vocab_snapshots ORDER BY at ASC')
            .all()
            .map((r) => ({ at: String(r.at), count: Number(r.item_count), library: parsePayload(String(r.payload)) })),
          articles: this.listArticles(),
          articlePrev: db
            .prepare('SELECT article_id, updated_at, payload FROM article_prev ORDER BY article_id ASC')
            .all()
            .map((r) => ({
              articleId: String(r.article_id),
              updatedAt: String(r.updated_at),
              value: parsePayload(String(r.payload)),
            })),
          learning: this.loadLearning(),
          learningSnapshots: db
            .prepare('SELECT id, at, reason, record_count, payload FROM learning_snapshots ORDER BY id ASC')
            .all()
            .map((r) => ({
              id: Number(r.id),
              at: String(r.at),
              reason: String(r.reason ?? ''),
              recordCount: Number(r.record_count),
              value: parsePayload(String(r.payload)),
            })),
        }
      },
      checkpoint() {
        try {
          db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
        } catch {
          // ignore
        }
      },
      /**
       * 导出一个**一致性快照**。
       * 不能只拷主库文件：WAL 模式下最近的提交可能还在 -wal 里，
       * checkpoint 遇到读者时也可能 busy。`VACUUM INTO` 会生成一个完整、独立的新库。
       */
      backupTo(dest) {
        const target = String(dest).replace(/'/g, "''")
        db.exec(`VACUUM INTO '${target}'`)
      },
    }
    cache.set(dbPath, store)
    return store
  } catch (e) {
    // 打不开就返回 null，让前端回退 IndexedDB；错误写日志方便排查。
    // 不缓存失败：磁盘临时只读、锁冲突、备份失败修好后，下一次请求还能重试。
    console.error('[sqlite] 打开失败：', e instanceof Error ? e.message : e)
    return null
  }
}

/** 测试用：关掉所有连接。 */
export function closeAllStores() {
  for (const store of cache.values()) {
    try {
      store?.close()
    } catch {
      // ignore
    }
  }
  cache.clear()
}
