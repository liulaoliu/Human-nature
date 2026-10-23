import { chmodSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
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
import { list, nowIso, text, tx } from './sqliteUtil.js'
import { rebuildVocabProjection } from './sqliteVocab.js'
import {
  deleteArticleProjection,
  normalizeLegacySourceIds,
  rebuildAllProjections,
  rebuildArticleProjection,
  rememberArticlePrev,
} from './sqliteProjection.js'

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
/**
 * 留最近 5 版 + 历史最大的一版。
 *
 * 从 8 降到 5 是为了磁盘：整库 payload 16MB，8 版就是 128MB，占满整个 `.db` 的一多半。
 * 5 版已经够「误操作后回退」用（再往前的一天一份整库备份还留着）。
 */
const SNAP_KEEP = 5

/**
 * 写词库时的版本冲突（另一个标签页/工具已经改过）。
 *
 * 为什么要有：前端持有的是**整份**词库，任何一次保存都是全量覆盖。没有版本校验时，
 * 一个开着没刷新的旧标签页只要点一下，就能把别处刚修好的几百条改动静默抹掉
 * （2026-10-22 真实事故：修到 8306 条，被 20:12 的旧页面写成 8302）。
 */
export class VocabConflictError extends Error {
  constructor(updatedAt, count) {
    super(`词库已被其它页面改过（服务器 ${count} 条，${updatedAt}）`)
    this.name = 'VocabConflictError'
    this.code = 'VOCAB_CONFLICT'
    this.updatedAt = updatedAt
    this.count = count
  }
}

/**
 * 快照 / 上一版压成 gzip BLOB 再存：同样的 JSON，16MB → 约 2MB。
 *
 * 只压这两张历史表。`vocab` 主表仍是明文 JSON —— 导出、体检脚本、`sqlite3` 手动排错
 * 都要直接读它，压了反而添麻烦。
 */
function packPayload(json) {
  return gzipSync(Buffer.from(json, 'utf8'), { level: 6 })
}

/** 历史表里既可能是老版本的明文 TEXT，也可能是新写入的 gzip BLOB。 */
function unpackPayload(value) {
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array) return gunzipSync(Buffer.from(value)).toString('utf8')
  return String(value)
}

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

/**
 * 版本号必须严格递增：乐观锁拿 `updated_at` 当令牌，同一毫秒里连存两次
 * 会得到两个相同的令牌，旧客户端就能蒙混过关。宁可变慢 1ms。
 */
function nextUpdatedAt(db) {
  const prev = db.prepare('SELECT updated_at FROM vocab WHERE id = 1').get()
  const prevAt = prev ? String(prev.updated_at) : ''
  const now = nowIso()
  if (!prevAt) return now
  return now > prevAt ? now : new Date(Date.parse(prevAt) + 1).toISOString()
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

/**
 * v4：早期词条的 `source.articleId` 存的是文章标题（不是 `saved:…` id）。
 * 重新切句后按标题还能唯一对上，就一次性换成真正的文章 id；
 * 结构相同的 `examples[].articleId` / `contexts[].articleId` 一起换。
 *
 * 只改能唯一对上的标题；同名文章、找不到的标题保持原样，不猜。
 */
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

/**
 * 启动时回收空间：删掉大量快照/文章之后，SQLite 不会自己把 .db 文件缩小，
 * 关掉进程也不 checkpoint，`-wal` 会一直留着（本库实测 55MB）。
 *
 * 只在空闲页占比明显时才 VACUUM —— 226MB 的库全量重写要几秒，不能每次启动都干。
 */
const VACUUM_MIN_FREE_PAGES = 2000
function reclaimSpace(db) {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } catch {
    // 还有别的连接在用这个库，跳过；下次启动再收
  }
  try {
    const free = Number(db.prepare('PRAGMA freelist_count').get()?.freelist_count ?? 0)
    const total = Number(db.prepare('PRAGMA page_count').get()?.page_count ?? 0)
    if (free >= VACUUM_MIN_FREE_PAGES && total > 0 && free / total >= 0.15) {
      db.exec('VACUUM')
      console.info(`[sqlite] 回收空闲页 ${free} / ${total}`)
    }
  } catch (e) {
    console.warn('[sqlite] 回收空间失败：', e instanceof Error ? e.message : e)
  }
}

/**
 * 启动时整理历史快照：新策略裁到 5 版，并把老版本存的**明文 JSON** 转成 gzip。
 *
 * 一次性成本（本库 9 版 × 16MB 明文 → 6 版 × 约 2MB），之后每次启动只做一次 count 查询。
 * 幂等：`typeof payload === 'string'` 才算待转换，转过的读出来是 BLOB。
 */
function maintainSnapshots(db) {
  try {
    pruneSnapshots(db)
    const legacy = db
      .prepare('SELECT at, payload FROM vocab_snapshots')
      .all()
      .filter((r) => typeof r.payload === 'string')
    if (!legacy.length) return
    const upd = db.prepare('UPDATE vocab_snapshots SET payload = ? WHERE at = ?')
    tx(db, () => {
      for (const r of legacy) upd.run(packPayload(String(r.payload)), String(r.at))
    })
    console.info(`[sqlite] 压缩历史快照 ${legacy.length} 版`)
  } catch (e) {
    // 整理失败不影响使用：快照本来就有明文/压缩两种读法
    console.warn('[sqlite] 整理快照失败：', e instanceof Error ? e.message : e)
  }
}

function assertDatabaseHealthy(db) {
  const row = db.prepare('PRAGMA quick_check').get()
  const result = row ? Object.values(row)[0] : 'ok'
  if (String(result).toLowerCase() !== 'ok') {
    throw new Error(`SQLite 完整性检查未通过：${String(result)}`)
  }
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
    // 先整理历史快照，再回收空间：备份是 VACUUM INTO 的整库副本，库里的空格子会一起被复制。
    maintainSnapshots(db)
    reclaimSpace(db)
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
      /** 词库的版本号（= 最后一次保存时间）与条数；乐观锁靠它判断「客户端看到的是不是最新」。 */
      vocabMeta() {
        const row = db.prepare('SELECT item_count, updated_at FROM vocab WHERE id = 1').get()
        return row ? { updatedAt: String(row.updated_at), count: Number(row.item_count) } : null
      },
      loadPrev() {
        const row = db.prepare('SELECT payload FROM vocab_prev WHERE id = 1').get()
        return row ? parsePayload(unpackPayload(row.payload)) : null
      },
      listSnapshots() {
        return db
          .prepare('SELECT at, item_count FROM vocab_snapshots ORDER BY at DESC')
          .all()
          .map((r) => ({ at: String(r.at), count: Number(r.item_count) }))
      },
      loadSnapshot(at) {
        const row = db.prepare('SELECT payload FROM vocab_snapshots WHERE at = ?').get(String(at))
        return row ? parsePayload(unpackPayload(row.payload)) : null
      },
      /**
       * 保存词库。`baseUpdatedAt` 是客户端**读到的那一版**：传了就必须和服务器当前版本一致，
       * 否则抛 VocabConflictError（不传 = 强制写，留给迁移/工具脚本用）。
       */
      saveVocab(lib, opts = {}) {
        assertLibrary(lib)
        const payload = JSON.stringify(lib)
        const count = lib.items.length
        const base = opts.baseUpdatedAt ? String(opts.baseUpdatedAt) : ''
        const out = tx(db, () => {
          const prev = db.prepare('SELECT payload, item_count, updated_at FROM vocab WHERE id = 1').get()
          // 版本对不上就别写：调用方拿到 409 后刷新，比"我这边赢了但别人的改动没了"好
          if (base && prev && String(prev.updated_at) !== base) {
            throw new VocabConflictError(String(prev.updated_at), Number(prev.item_count))
          }
          // 内容没变就别再全量重建派生表/写快照（自动补全 effect 重跑时很常见）。
          if (prev && String(prev.payload) === payload) return { updatedAt: String(prev.updated_at), count }
          const at = nextUpdatedAt(db)
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
          // 上一版 = 「刚被覆盖的那一版」。旧规则是「只留条数更大的那份」，后果是
          // 一旦历史最大值出现（本库 8731 条 / 10-20），之后所有缩水事故都进不了 prev，
          // 用户点「恢复上一版」拿到的是几天前的库。只有空库不算上一版。
          if (prev && Number(prev.item_count) > 0) {
            db.prepare(
              'INSERT OR REPLACE INTO vocab_prev (id, payload, item_count, updated_at) VALUES (1, ?, ?, ?)',
            ).run(packPayload(String(prev.payload)), Number(prev.item_count), String(prev.updated_at))
          }
          db.prepare(
            'INSERT OR REPLACE INTO vocab (id, payload, item_count, updated_at) VALUES (1, ?, ?, ?)',
          ).run(payload, count, at)
          db.prepare('INSERT OR REPLACE INTO vocab_snapshots (at, payload, item_count) VALUES (?, ?, ?)').run(
            nextSnapshotAt(db),
            packPayload(payload),
            count,
          )
          pruneSnapshots(db)
          rebuildVocabProjection(db, lib, prevLib)
          return { updatedAt: at, count }
        })
        // 一次保存写 16MB，WAL 会跟着涨；PASSIVE 不阻塞读，顺手把能并的并回去。
        try {
          db.exec('PRAGMA wal_checkpoint(PASSIVE)')
        } catch {
          // 有别的连接在读时 checkpoint 可能被拒，下次保存再试，不影响这次写入
        }
        return out
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
            packPayload(payload),
            count,
          )
          rebuildVocabProjection(db, lib)
          return { migrated: true, value: lib }
        })
      },
      clearVocab() {
        tx(db, () => {
          const cur = db.prepare('SELECT payload, item_count, updated_at FROM vocab WHERE id = 1').get()
          // 清空不是「上一版」的候选，它就是要被恢复的那一版
          if (cur && Number(cur.item_count) > 0) {
            db.prepare(
              'INSERT OR REPLACE INTO vocab_prev (id, payload, item_count, updated_at) VALUES (1, ?, ?, ?)',
            ).run(packPayload(String(cur.payload)), Number(cur.item_count), String(cur.updated_at))
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
            .map((r) => ({ at: String(r.at), count: Number(r.item_count), library: parsePayload(unpackPayload(r.payload)) })),
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
