/**
 * SQLite schema 定义与版本号。
 *
 * 事实来源仍然是 JSON payload；这里只放表结构，避免 store 的读写逻辑被 DDL 淹没。
 * v1 → v2 迁移：新增派生表 + articles 查询列，旧库打开时由 sqliteStore 自动迁移。
 */

export const SCHEMA_VERSION = 2

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
