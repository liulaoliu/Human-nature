/**
 * SQLite schema 定义与版本号。
 *
 * 事实来源仍然是 JSON payload；这里只放表结构，避免 store 的读写逻辑被 DDL 淹没。
 * 旧库打开时由 sqliteStore 自动迁移：v2 派生表 + articles 查询列，v3 学习记录，
 * v4 旧词条文章 id，v5 学习记录快照，v6 文章上一版。
 */

export const SCHEMA_VERSION = 7

export const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS vocab (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS vocab_prev (
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
 * v5：学习记录快照。
 *
 * 学习记录是直接写在规范化表里的，没有 JSON 事实来源可回滚；每次替换/增量写之前
 * 先留一份完整快照，缩水、误清空、迁移出错时都能恢复。
 * 只留最近若干份；快照表不进 `hasLearningRows`，避免“只有快照没有记录”时误判。
 */
export const SCHEMA_V5 = `
CREATE TABLE IF NOT EXISTS learning_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  record_count INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learning_snapshots_at ON learning_snapshots(at DESC);
`

/**
 * v6：文章上一版。
 *
 * 文章正文/翻译/句子切分是用户资产，但原来 `saveArticle` 直接覆盖，误编辑没有退路。
 * 每次覆盖或删除前把当前 payload 留一份；一篇文章只留最近一版，恢复时可反悔。
 */
export const SCHEMA_V6 = `
CREATE TABLE IF NOT EXISTS article_prev (
  article_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
`

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

CREATE TABLE IF NOT EXISTS learning_derived_baseline (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload TEXT NOT NULL,
  at TEXT NOT NULL
);
`
