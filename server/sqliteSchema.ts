/**
 * SQLite schema 定义与版本号。
 *
 * 事实来源仍然是 JSON payload；这里只放表结构，避免 store 的读写逻辑被 DDL 淹没。
 * 旧库打开时由 sqliteStore 自动迁移：v2 派生表 + articles 查询列，v3 学习记录，
 * v4 旧词条文章 id，v7 答题事件与聚合基线，v8 回译存档；
 * v5（学习记录快照）/ v6（文章上一版）已退役，只保留版本号、不再建表。
 */

export const SCHEMA_VERSION = 8

export const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS vocab (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS vocab_snapshots (
  at TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  item_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_articles_updated ON articles(updated_at DESC);
`

export const SCHEMA_V2 = `
CREATE TABLE IF NOT EXISTS words (
  id TEXT PRIMARY KEY,
  word TEXT NOT NULL,
  lemma TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'word',
  lang_point_id TEXT,
  phonetic TEXT,
  part_of_speech TEXT,
  meaning TEXT,
  definition TEXT,
  status TEXT NOT NULL DEFAULT 'unqueried',
  note TEXT NOT NULL DEFAULT '',
  source_article_id TEXT,
  source_file_name TEXT,
  source_sentence_id TEXT,
  source_sentence_text TEXT,
  review_ease REAL NOT NULL DEFAULT 2.5,
  review_due TEXT,
  review_interval INTEGER NOT NULL DEFAULT 0,
  review_repetitions INTEGER NOT NULL DEFAULT 0,
  review_lapses INTEGER NOT NULL DEFAULT 0,
  last_printed_at TEXT,
  priority_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_words_word ON words(word);
CREATE INDEX IF NOT EXISTS idx_words_lemma ON words(lemma);
CREATE INDEX IF NOT EXISTS idx_words_kind ON words(kind);
CREATE INDEX IF NOT EXISTS idx_words_status ON words(status);
CREATE INDEX IF NOT EXISTS idx_words_updated ON words(updated_at DESC);

CREATE TABLE IF NOT EXISTS word_usage (
  word_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (word_id, ordinal)
);
CREATE TABLE IF NOT EXISTS word_phrases (
  word_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (word_id, ordinal)
);
CREATE TABLE IF NOT EXISTS word_idioms (
  word_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (word_id, ordinal)
);
CREATE TABLE IF NOT EXISTS word_tags (
  word_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (word_id, ordinal)
);
CREATE TABLE IF NOT EXISTS word_grammar_marks (
  word_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (word_id, ordinal)
);
CREATE TABLE IF NOT EXISTS word_examples (
  word_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  translation TEXT,
  article_id TEXT,
  file_name TEXT,
  sentence_id TEXT,
  origin TEXT,
  PRIMARY KEY (word_id, ordinal)
);
CREATE INDEX IF NOT EXISTS idx_word_examples_word ON word_examples(word_id);
CREATE TABLE IF NOT EXISTS word_contexts (
  word_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  article_id TEXT NOT NULL,
  file_name TEXT,
  sentence_id TEXT,
  sentence_text TEXT NOT NULL,
  meaning TEXT,
  at TEXT NOT NULL,
  PRIMARY KEY (word_id, ordinal)
);
CREATE INDEX IF NOT EXISTS idx_word_contexts_word ON word_contexts(word_id);
CREATE INDEX IF NOT EXISTS idx_word_contexts_article ON word_contexts(article_id);
CREATE TABLE IF NOT EXISTS word_confusables (
  word_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  word TEXT NOT NULL,
  meaning TEXT,
  PRIMARY KEY (word_id, ordinal)
);

CREATE TABLE IF NOT EXISTS article_sentences (
  article_id TEXT NOT NULL,
  id TEXT NOT NULL,
  para_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  audio_start REAL,
  audio_end REAL,
  translation TEXT,
  grammar_note TEXT,
  review_ease REAL NOT NULL DEFAULT 2.5,
  review_due TEXT,
  review_interval INTEGER NOT NULL DEFAULT 0,
  review_repetitions INTEGER NOT NULL DEFAULT 0,
  review_lapses INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (article_id, id)
);
CREATE INDEX IF NOT EXISTS idx_article_sentences_article ON article_sentences(article_id, ordinal);

CREATE TABLE IF NOT EXISTS article_collocations (
  article_id TEXT NOT NULL,
  sentence_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (article_id, sentence_id, ordinal)
);
CREATE TABLE IF NOT EXISTS article_sentence_vocab (
  article_id TEXT NOT NULL,
  sentence_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  word TEXT NOT NULL,
  PRIMARY KEY (article_id, sentence_id, ordinal)
);
CREATE TABLE IF NOT EXISTS article_sentence_tags (
  article_id TEXT NOT NULL,
  sentence_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (article_id, sentence_id, ordinal)
);
CREATE INDEX IF NOT EXISTS idx_article_sentence_vocab_word ON article_sentence_vocab(word);

CREATE TABLE IF NOT EXISTS article_paragraphs (
  article_id TEXT NOT NULL,
  id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (article_id, id)
);
CREATE TABLE IF NOT EXISTS article_paragraph_sentences (
  article_id TEXT NOT NULL,
  paragraph_id TEXT NOT NULL,
  sentence_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (article_id, paragraph_id, sentence_id)
);

CREATE TABLE IF NOT EXISTS lang_points (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  sentence_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  source TEXT,
  structure TEXT,
  grammar TEXT,
  at TEXT
);
CREATE INDEX IF NOT EXISTS idx_lang_points_article ON lang_points(article_id);
CREATE INDEX IF NOT EXISTS idx_lang_points_sentence ON lang_points(sentence_id);

CREATE TABLE IF NOT EXISTS lang_point_terms (
  lang_point_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (lang_point_id, kind, ordinal)
);
CREATE INDEX IF NOT EXISTS idx_lang_point_terms_text ON lang_point_terms(text);
`

/**
 * v3：学习记录（durable learning records）。
 *
 * 只收“丢了会影响日志/统计/换浏览器”的记录：练习成绩、错题、读完/精读进度、
 * 写作、复述、活动统计、背词/选词记录。
 * 偏好/会话状态（主题、字号、面板开关、上次文章、草稿、会话快照）仍留在 localStorage，
 * 不要为了“全都进 SQLite”把它们塞进来。
 */
export const SCHEMA_V3 = `
CREATE TABLE IF NOT EXISTS practice_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  seconds REAL,
  article_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_practice_records_at ON practice_records(at);

CREATE TABLE IF NOT EXISTS mistake_records (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  at TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  label TEXT NOT NULL DEFAULT '',
  item_id TEXT,
  question_json TEXT,
  article_id TEXT,
  text TEXT
);
CREATE INDEX IF NOT EXISTS idx_mistake_records_kind_at ON mistake_records(kind, at DESC);

CREATE TABLE IF NOT EXISTS reading_progress (
  article_id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reading_progress_day ON reading_progress(day);

CREATE TABLE IF NOT EXISTS writing_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  article_id TEXT NOT NULL DEFAULT '',
  article_title TEXT,
  model TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  feedback_json TEXT NOT NULL,
  task_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_writing_records_at ON writing_records(at DESC);

CREATE TABLE IF NOT EXISTS retell_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  article_id TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  words INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_retell_records_at ON retell_records(at DESC);

CREATE TABLE IF NOT EXISTS activity_days (
  day TEXT NOT NULL,
  cat TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, cat)
);

CREATE TABLE IF NOT EXISTS study_days (
  day TEXT PRIMARY KEY,
  seconds INTEGER NOT NULL DEFAULT 0,
  cards INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pick_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  picked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pick_sessions_at ON pick_sessions(at);

CREATE TABLE IF NOT EXISTS study_word_days (
  day TEXT NOT NULL,
  word_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, word_id)
);
CREATE INDEX IF NOT EXISTS idx_study_word_days_day ON study_word_days(day);

CREATE TABLE IF NOT EXISTS skimmed_articles (
  article_id TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS kind_stats (
  article_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (article_id, kind)
);
`

/**
 * v5（已退役）：原「学习记录快照」表。
 *
 * 这个功能没有前端入口、恢复只能靠 curl，已按产品决定删除：每次写学习记录前
 * 不再整份存快照。老库里的 `learning_snapshots` 表不删不读，可自行 `DROP`。
 * 常量保留为空串只为记住版本号归谁，迁移时直接升版本号、不建表。
 */
export const SCHEMA_V5 = ''

/**
 * v6（已退役）：原「文章上一版」表。
 *
 * 文章覆盖/删除前不再留上一版；回滚粒度改为 `data/backups/` 的每日整库备份。
 * 老库里的 `article_prev` 表不删不读，可自行 `DROP`。
 */
export const SCHEMA_V6 = ''

/**
 * v7：答题事件（append-only）。
 *
 * activity_days / kind_stats 只有聚合值，丢了/算错就无法对账。
 * 新事件逐题落库；迁移时的历史聚合另存为 baseline，以后用
 * 「baseline + events」就能重建派生统计，且不假装历史能量化到题。
 */
export const SCHEMA_V7 = `
CREATE TABLE IF NOT EXISTS answer_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  day TEXT NOT NULL DEFAULT '',
  article_id TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  cat TEXT NOT NULL,
  correct INTEGER NOT NULL DEFAULT 0,
  question_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_answer_events_at ON answer_events(at);
CREATE INDEX IF NOT EXISTS idx_answer_events_article_kind ON answer_events(article_id, kind);
-- append-only：同一题重复同步时按内容去重（question_id 可能为 NULL，统一成空串）
CREATE UNIQUE INDEX IF NOT EXISTS idx_answer_events_key ON answer_events(
  at, article_id, source, kind, cat, correct, COALESCE(question_id, '')
);

CREATE TABLE IF NOT EXISTS learning_derived_baseline (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload TEXT NOT NULL,
  at TEXT NOT NULL
);
`

/**
 * v8：回译训练存档。
 *
 * 记录自包含（中文题干 + 答案 + 原句 + 批改），文章删了也能回看；
 * 按 id 去重，长期保留，不做「只留最近 N 条」的截断。
 */
export const SCHEMA_V8 = `
CREATE TABLE IF NOT EXISTS back_translation_records (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  article_id TEXT NOT NULL DEFAULT '',
  article_title TEXT,
  sentence_id TEXT NOT NULL DEFAULT '',
  source_zh TEXT NOT NULL DEFAULT '',
  context_zh TEXT,
  answer TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  feedback_json TEXT NOT NULL DEFAULT '{}',
  exact INTEGER NOT NULL DEFAULT 0,
  ratio REAL NOT NULL DEFAULT 0,
  graded_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_back_translation_records_at ON back_translation_records(at DESC);
CREATE INDEX IF NOT EXISTS idx_back_translation_records_article ON back_translation_records(article_id, at DESC);
`
