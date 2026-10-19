# 数据存储：SQLite 主存 + IndexedDB 兜底

> 结论先说：**该换，但不是“把 IndexedDB 全删了”**。
> 这个应用有本地 Node 服务，SQLite 放在服务端最合适；浏览器 IndexedDB 保留为
> **静态部署 / 服务没起 / 服务挂了**时的兜底。词库和已保存文章已经按这个方案落地。

## 一、为什么换

IndexedDB 适合“浏览器里临时存一点”，不适合当唯一资产库：

- **按来源隔离**：协议 + 域名 + 端口任一变化就是另一套库；端口从 5173 换成 5174，数据就“看不见”了。
- **在浏览器 Profile 深处**：用户找不到文件，换机器、拷备份、用 SQL 查都麻烦。
- **会被浏览器回收**：存储压力大时可能被清；无痕模式更不用说。
- **多标签页没有统一事务**：同一个词库多个页面各写各的，容易互相覆盖。
- **没有 schema 版本/索引/查询**：功能一多，迁移、统计、导出都要在 JSON 上手写。

SQLite 解决的是这些**运维和演进问题**，不是“加了 SQLite 就自动安全”。安全还靠文件权限、
只监听本机、同源校验和备份策略。

## 二、当前数据分层

| 数据 | 主存 | 兜底 | 说明 |
|---|---|---|---|
| 词库（生词 / 语言点 / 复习状态） | `data/xueba.db` 的 `vocab` + `vocab_prev` + `vocab_snapshots` | IndexedDB `shadowing-vocab` | 唯一资产，优先迁 |
| 已保存文章（正文 / 句子 / 翻译） | `data/xueba.db` 的 `articles` | IndexedDB `shadowing-reader` | 文本，第二优先 |
| 跟读录音 | IndexedDB `shadowing` | 无 | 音频 blob，体积大；下一阶段改成 `data/takes/` 文件 + SQLite 元数据 |
| 校准 / 改过的正文 | localStorage | 无 | 一篇几个数字 / 几十 KB，同步接口更简单，暂不迁 |
| 统计 / 目标 / 错题等 | localStorage | 无 | 已随「导出全部」备份 |
| TTS 音频缓存 | `public/tts/` | 浏览器语音 | 可再生，不算用户资产 |

## 三、运行时怎么选

前端仓储（`src/adapters/vocabRepo.ts`、`articleRepo.ts`）是 **HybridRepo**：

```
页面启动
  ├ GET /api/store/health 通
  │    ├ GET /api/store/vocab|articles → 用 SQLite
  │    ├ 服务端空库 → 把 IndexedDB 里的旧数据迁上去（if-empty，事务内检查）
  │    └ 每次写 SQLite 成功 → 顺手镜像一份 IndexedDB（本机备份）
  └ 不通 / 503 / 静态部署
       └ 全部走原来的 IndexedDB 实现
```

- 迁移是**一次性、自动**的：服务端已有数据就以服务端为准，不会被旧 IndexedDB 覆盖。
- 同一 id 的文章两边都有时，`updatedAt` 更新的那一版优先（离线改过的不会被旧库盖掉）。
- 服务端写失败会降到 IndexedDB 继续写，不让功能卡死；下次刷新会重新探测。
- **没有本地服务时**（把 `dist` 丢到任意静态服务器 / GitHub Pages）行为跟以前一样，只是没有 SQLite。

## 四、数据库长什么样

文件：`data/xueba.db`（可用 `XUEBA_DB` 覆盖），目录随项目，已被 `.gitignore` 忽略。
schema 版本：`PRAGMA user_version = 2`。

### 4.1 事实来源（JSON 快照）

```sql
vocab(id=1, payload JSON, item_count, updated_at)
vocab_prev(id=1, payload JSON, item_count, updated_at)      -- 覆盖前那一版
vocab_snapshots(at, payload JSON, item_count)               -- 最近 8 版 + 历史最大一版
articles(id, payload JSON, title, book, source_key,
         created_at, updated_at, sentence_count, word_count)
```

- `payload` 保存完整的 `VocabLibrary` / `SavedArticle`，**事实来源**是它；
  整库回滚、导出、旧版本兼容、换 DB 时的 JSON 导入都靠它。
- 词库备份语义与 IndexedDB 实现一致：覆盖前留「上一版」，且**只留更大的那一份**；
  缩水事故（读失败/误清）时，备份里是事故前那一版。

### 4.2 派生表（给 SQL / 统计 / 以后 FTS 用）

每次 `saveVocab` / `saveArticle` 在**同一个事务**里从 JSON 重建，不能单独写；
所以不会出现「JSON 更新了、表还是旧的」。

```sql
-- 词条：单词 / 词组 / 习语 / 用法笔记共用
words(
  id, word, lemma, kind, lang_point_id,
  phonetic, part_of_speech, meaning, definition,
  status, note,
  source_article_id, source_file_name, source_sentence_id, source_sentence_text,
  review_ease, review_due, review_interval, review_repetitions, review_lapses,
  last_printed_at, priority_until, created_at, updated_at
)
word_usage(word_id, ordinal, text)          -- usage[]
word_phrases(word_id, ordinal, text)        -- phrases[]
word_idioms(word_id, ordinal, text)         -- idioms[]
word_tags(word_id, ordinal, text)           -- tags[]
word_grammar_marks(word_id, ordinal, text)  -- grammarMarks[]
word_examples(word_id, ordinal, text, translation, article_id, file_name, sentence_id, origin)
word_contexts(word_id, ordinal, article_id, file_name, sentence_id, sentence_text, meaning, at)
word_confusables(word_id, ordinal, word, meaning)

-- 文章：句子 / 翻译 / 段落 / 句子级标签
article_sentences(article_id, id, para_id, ordinal, text, audio_start, audio_end,
                  translation, grammar_note, review_ease, review_due,
                  review_interval, review_repetitions, review_lapses)
article_paragraphs(article_id, id, ordinal)
article_paragraph_sentences(article_id, paragraph_id, sentence_id, ordinal)
article_collocations(article_id, sentence_id, ordinal, text)
article_sentence_vocab(article_id, sentence_id, ordinal, word)
article_sentence_tags(article_id, sentence_id, ordinal, text)

-- 语言点：AI 一条 + 手动若干条；正文里的 structure/grammar 在 lang_points
lang_points(id, article_id, sentence_id, ordinal, source, structure, grammar, at)
lang_point_terms(lang_point_id, kind, ordinal, text)  -- kind = idiom | phrase | usage
```

几个映射要点：

| 界面数据 | 存哪 |
|---|---|
| 单词 / 音标 / 释义 / 英英释义 | `words` |
| 用法 / 词组 / 习语 / 标签 / 语法标记 | `word_usage`、`word_phrases`、`word_idioms`、`word_tags`、`word_grammar_marks` |
| 例句（AI / 离线 / 来源句） | `word_examples.origin` |
| 这个词在哪些文章/句子里出现过 | `word_contexts` |
| 复习状态 | `words.review_*`、`article_sentences.review_*` |
| 文章正文 / 句子顺序 | `articles.payload` + `article_sentences.ordinal`、`article_paragraphs` |
| 句子翻译 | `article_sentences.translation` |
| 句子语法说明 / 搭配 / 本句生词 | `article_sentences.grammar_note`、`article_collocations`、`article_sentence_vocab` |
| 手动/AI 语言点 | `lang_points` + `lang_point_terms`（词组/习语/用法） |
| 历史版本 | `vocab_snapshots`（整库 JSON） |

### 4.3 性能与边界

- 当前单用户、词库千级：整库 JSON 约 1–2MB，保存时重建 1k 多行派生表约百毫秒；
  读取仍走 JSON，页面不需要逐表 JOIN。
- 如果词库涨到几万/几十万，**不要继续每次全量重建**：改成按 `updatedAt` 增量 upsert，
  再给 `words` / `article_sentences` 建 FTS5；这是下一阶段，不是现在。
- `words(lemma)`、`words(updated_at)`、`article_sentences(article_id, ordinal)`、
  `lang_point_terms(text)` 都有索引；复杂查询直接开 `data/xueba.db` 用 SQL：

  ```bash
  sqlite3 data/xueba.db "SELECT word, meaning FROM words WHERE lemma = 'run';"
  sqlite3 data/xueba.db "SELECT s.text, s.translation FROM article_sentences s WHERE s.text LIKE '%recession%';"
  sqlite3 data/xueba.db "SELECT l.sentence_id, t.kind, t.text FROM lang_points l JOIN lang_point_terms t ON t.lang_point_id = l.id;"
  ```

- 写放大：每次保存会写 JSON + 快照 + 派生表；本地 SSD 可接受。快照只留 8 版 + 最大一版，
  不会无限增长。

## 五、导出 / 备份

| 方式 | 怎么做 | 内容 |
|---|---|---|
| 下载 SQLite 文件 | 浏览器打开 `http://localhost:5173/api/store/db`，或 `curl -OJ http://localhost:5173/api/store/db` | 用 `VACUUM INTO` 生成的一致性快照（含 WAL 中已提交数据），可用 DB Browser / `sqlite3` 打开 |
| 导出 JSON | `GET /api/store/export`（加 `?download=1` 直接下载） | 词库 + 上一版 + 快照 + 文章 |
| 应用内「导出全部（备份）」 | 侧栏按钮 | 词库 + 文章 + localStorage 统计，换机器用这个最全 |
| 历史词库 | 侧栏「恢复上一版词库」/ `GET /api/store/vocab/snapshots` | 最近 8 版 + 历史最大一版 |

## 六、安全

- `server/appServer.js` 只监听 `127.0.0.1`；SQLite 接口不对局域网开放。
- DB 文件 `0600`、目录 `0700`（Windows 忽略权限位）。
- 写接口校验 `Origin`：浏览器跨站页面不能往 `127.0.0.1` 写数据（curl / 本机脚本不带 Origin 仍可用）。
- 只暴露固定路由，不提供任意 SQL 执行；请求体上限 64MB。
- 真正防丢仍靠：SQLite 快照 + IndexedDB 镜像 + 「导出全部」+ 定期把 `data/xueba.db` 拷走。

## 七、分层与换 DB

当前的依赖方向：

```
React 视图 / hooks
      ↓ 只依赖 core/ports.ts（VocabRepoPort / ArticleRepoPort / TakeRepoPort…）
HybridRepo（adapters：SQLite 优先，IndexedDB 兜底）
      ↓ HTTP /api/store/*
server/storeApi.js（路由，不认识具体 DB）
      ↓ 同一组方法：loadVocab / saveVocab / listArticles / saveArticle…
server/sqliteStore.js（SQLite 实现）
```

所以：

- **UI / hooks 不直接碰 SQL、不直接 fetch `/api/store`**；换 DB 不动视图。
- 换到 Postgres / MySQL 时，主要写一个新的 `server/pgStore.js`，保持
  `loadVocab / saveVocab / loadPrev / listSnapshots / listArticles / saveArticle / removeArticle /
  exportAll / checkpoint` 这组方法签名，然后让 `storeApi.js` 改用它。
- 前端 `HybridRepo` 不需要改：它只认 HTTP 契约和 `/api/store/health`。
- **不是“零成本”**：`sqliteStore.js` 里的 `PRAGMA user_version`、`INSERT OR REPLACE`、
  `wal_checkpoint`、JSON 列都是 SQLite 方言；派生表的 SQL 大部分是标准 SQL，但迁移脚本要重写。
- 端口是**领域仓储**，不是通用 CRUD 生成器：词库、文章、录音各有自己的语义；
  这比“一个万能 KV 表”更难被某个 DB 绑死，也更能保证业务约束。
- 录音（`TakeRepoPort`）和校准/改文本目前还是 IndexedDB / localStorage：
  换 DB 时它们是下一批要补的端口实现。

## 八、下一阶段（还没做）

1. **录音迁到服务端**：`data/takes/<id>.bin` + SQLite 元数据（`file_name` 索引），
   前端 `HybridTakeRepo`；第一次打开某篇时把该篇旧录音补传。
2. **校准 / 改文本**：接口是同步的，迁 SQLite 要改成异步；数据很小，优先级低。
3. **FTS5 全文搜索**：词库/文章上 SQLite FTS，替代前端内存过滤。
4. **多设备**：SQLite 文件放同步盘或加一个导出/导入入口；不做账号系统。
