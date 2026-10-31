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
| 词库（生词 / 语言点 / 复习状态） | `data/xueba.db` 的 `vocab` + `vocab_snapshots` | IndexedDB `shadowing-vocab` | 唯一资产，优先迁 |
| 已保存文章（正文 / 句子 / 翻译） | `data/xueba.db` 的 `articles` | IndexedDB `shadowing-reader` | 文本，第二优先 |
| 跟读录音 | IndexedDB `shadowing` | 无 | 音频 blob，体积大；下一阶段改成 `data/takes/` 文件 + SQLite 元数据 |
| 校准 / 改过的正文 | localStorage | 无 | 一篇几个数字 / 几十 KB，同步接口更简单，暂不迁 |
| **学习记录**（练习 / 错题 / 读完 / 精读 / 写作 / 回译 / 复述 / 活动统计 / 背词记录） | SQLite `data/xueba.db` 的 `learning_*` 表；localStorage 同步缓存 | `adapters/learningRepo` + `useLearningSync` | 换浏览器/清缓存可恢复；偏好/会话仍留 localStorage |
| 目标 / 备忘等偏好 | localStorage | 无 | `readGoal` / `goalMemo` 是设置，不是学习记录 |
| TTS 音频缓存 | `data/tts/` | 浏览器语音 | 可再生，不算用户资产 |

### 2.1 不是所有 localStorage 都该进 SQLite

按数据性质分，而不是按“能不能塞”分。Android 上也不会把 `SharedPreferences` 全搬进 Room。

| 类别 | 典型键 / 数据 | 放哪 | 理由 |
|---|---|---|---|
| 偏好 / 会话状态 | `reader:theme`、字号、语速、题型、面板开关、`reader:last`、`reader:quizSession`、`reader:writingDraft` | localStorage（大对象可放 IndexedDB） | 高频改、只影响本机 UI，丢了重设即可 |
| 可重建的缓存 / 派生统计 | `reader:kindStats`、`reader:newToday`、`reader:langCollected`、`reader:batch` | localStorage / IndexedDB | 能从词库、文章、事件重算；不要当事实来源 |
| **用户学习记录** | 背词事件、练习成绩、读完 / 精读进度、错题、写作历史、回译存档、复述记录 | **SQLite 规范化表** | 换浏览器/清缓存不能丢；要按天、按篇、按词查询 |
| 结构化资产 | 词库、文章、翻译、语言点、词在文章里的位置 | **SQLite**（已落地） | 同上，且需要 JOIN / 统计 |
| 大二进制 | 跟读录音、音频缓存 | 文件 / IndexedDB + SQLite 元数据 | 不适合塞进词库 JSON 或 localStorage |

结论：

- **偏好留在 localStorage**；不要把全部 `reader:*` 镜像成一张 `reader_state(key, value)` 万能 KV 表。
  那只是“换了个地方存 localStorage”：没有 schema、没法约束、每次写全量、还会和 localStorage 争谁是真身。
- **学习日志不是一张日志表**：它是按天聚合出来的视图。真正该落库的是
  `study_event`（哪天、哪个词、结果）、`practice_attempt`（成绩）、`reading_progress`（读完/略读）、
  `mistake`、`writing_record` 这类**事件 / 记录**；日志和统计从这些表算。
- **聚合值不要双写**：`reader:activity`、`reader:kindStats` 这类能由事件算出来的，最多做物化缓存；
  不要既写事件又手写一份聚合，最后两边对不上。
- **同一份数据只能有一个写入方**：迁移后 localStorage 只留“界面状态”，学习记录由 `LearningRepo`
  写 SQLite；否则刷新时谁覆盖谁说不清。

## 三、运行时怎么选

前端仓储（`src/adapters/vocabRepo.ts`、`articleRepo.ts`）是 **HybridRepo**：

```
页面启动
  ├ GET /api/store/health 通
  │    ├ GET /api/store/vocab|articles → 用 SQLite（vocab 响应带 updatedAt，写回时作乐观锁的 base）
  │    ├ 服务端空库 → 把 IndexedDB 里的旧数据迁上去（if-empty，事务内检查）
  │    ├ PUT /api/store/vocab 带 X-Vocab-Base → 版本对不上返回 409（不覆盖，提示刷新）
  │    └ 每次写 SQLite 成功 → 顺手镜像一份 IndexedDB（本机备份）
  └ 不通 / 503 / 静态部署
       └ 全部走原来的 IndexedDB 实现
```

- 迁移是**一次性、自动**的：服务端空库才把 IndexedDB 旧数据迁上去。
- 服务端有值也不代表它最新：`HybridVocabRepo` 只在**服务端写失败/服务不可用**时给 IndexedDB
  镜像置 `vocab:dirty`（v3 的 `meta` store）。`load()` 看到脏标记才以本地为准，不会静默用
  服务端旧版把离线改动顶掉；正常镜像（只是成功保存后的副本）一律用服务端。下一次保存会带
  服务端版本号写回，成功后清脏。两边都改过的真冲突目前仍本机优先并提示用户，合并选择是后续债务。
- 同一 id 的文章两边都有时，`updatedAt` 更新的那一版优先（离线改过的不会被旧库盖掉）。
- 词库里的句子原文按 `sentenceId` 共享：落盘前 `compactSentenceTexts` 收进
  `library.sentenceTexts`，读出来 `hydrateSentenceTexts` 补回 `source` / `contexts` /
  `articleEntries`。同一键文本不一致（改过正文）时不合并，避免张冠李戴。
- 删除写墓碑（`library.tombstones`）：本机/服务端合并时按 `updatedAt` / `addedAt`
  和墓碑时间比较，**已删词不会因为并集复活**；删完又加回来的新版本（时间更晚）保留。
  删全库词条会连带清掉各篇收录，避免留下孤儿 `articleEntries`。
- 文章的 `createdAt` 由服务端在覆盖保存时保留（客户端没带也不重置）；列表日期以建立日为主，
  只有内容真的改过才显示修改日。
- 服务端写失败会降到 IndexedDB 继续写，不让功能卡死；下次刷新会重新探测。
- **读失败后不许拿 `null` 当版本号写回**：`HybridVocabRepo` 会记 `revisionKnown=false`，
  服务恢复后的第一次写先补一次 `GET /vocab`；服务端已有词条就按 409 冲突提示刷新，
  只有服务端确实为空才允许 PUT（否则本地旧镜像会强制覆盖别处的新数据）。
- 词库 PUT 有 12s 超时；`useVocabLibrary` 保存失败会把那一版放回待写队列并按 1s→2s→4s…（封顶 15s）
  自动重试，成功一次清零。版本冲突不自动重试（重试等于替用户决定覆盖服务器）。
- IndexedDB 兜底库 `shadowing-vocab` 从 v1 升到 v3：v1 只建了 `library`，`snapshots` 从未创建；
  v2 补 `snapshots`，v3 再补 `meta`（只放未同步标记）。`onupgradeneeded` 必须把三个 store
  一次建齐，旧词库保留。快照读写都走 `snapshots` store。
- **没有本地服务时**（把 `dist` 丢到任意静态服务器 / GitHub Pages）行为跟以前一样，只是没有 SQLite。

## 四、数据库长什么样

文件：`data/xueba.db`（可用 `XUEBA_DB` 覆盖），目录随项目，已被 `.gitignore` 忽略。
schema 版本：`PRAGMA user_version = 10`（v3 建学习记录表，v4 修旧词条的标题式文章 id，v7 加答题事件与聚合基线，v8 加回译存档，v9 加 D老师小课堂进度，v10 给 `writing_records` 补 `source / sentence_id / exam_id`；v5/v6 已退役，分别对应删除的学习记录快照与文章上一版，只保留版本号）。

### 4.1 事实来源（JSON 快照）

```sql
vocab(id=1, payload BLOB, item_count, updated_at)          -- 当前词库（gzip；读一律走 unpackPayload）
vocab_snapshots(at, payload BLOB, item_count)               -- 最近 5 版 + 历史最大一版（gzip）
articles(id, payload JSON, title, book, source_key,
         created_at, updated_at, sentence_count, word_count)
```

- `payload` 保存完整的 `VocabLibrary` / `SavedArticle`，**事实来源**是它；
  整库回滚、导出、旧版本兼容、换 DB 时的 JSON 导入都靠它。
- 词库 payload 里有两层：`items`（全库 `VocabItem`，一个 lemma 一条，复习用）和
  `articleEntries`（每篇收录的 `ArticleVocabEntry`：序号 / 自动手动 / 语境释义 / 按篇打印时间）。
  派生表 `words` 只展开 `items`；按篇收录目前只存在 JSON 里（不做单独的派生表，避免两份编号口径）。
- 词库只留历史快照（最近 5 版 + 历史最大的一版）。「恢复上一版词库」已下线：
  界面不再提供一键退版，也没有 `vocab_prev` 槽位；新库不建这张表，**老库里遗留的
  `vocab_prev` 不再读写**，可忽略（或自行 `DROP TABLE vocab_prev`）。
- 文章覆盖/删除不再留上一版（v6 的 `article_prev` 已退役）：写坏了靠 `data/backups/`
  的每日整库备份；老库里遗留的 `article_prev` 不再读写，可自行 `DROP`。
- 两张词库表（`vocab` / `vocab_snapshots`）的 payload 都是 **gzip BLOB**；
  `unpackPayload` 两种都认，老明文库能直接读，**下次保存自动转成压缩态**。
  为什么主表也压：16MB 明文一次 INSERT 要 ~478ms，压缩后 1.5MB 只要几十毫秒，
  WAL / 备份 / 文件体积跟着一起降。代价是 `sqlite3` 里不能直接看 JSON，要 gunzip 一下。

### 4.2 派生表（给 SQL / 统计 / 以后 FTS 用）

每次 `saveVocab` / `saveArticle` 在**同一个事务**里从 JSON 重建，不能单独写；
所以不会出现「JSON 更新了、表还是旧的」。词库按 `id + 内容` 做**增量**（实现在
`server/sqliteVocab.js`）：只重写新增 / 变化 / 删除的词条，未变化的保留原 rowid；文章仍按整篇重建。

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

### 4.3 学习记录（v3–v10）

学习记录不是偏好，不能只靠 localStorage。表是规范化的事件/记录表，不做“万能 KV”：

```sql
practice_records(at, kind, total, correct, seconds, article_id)          -- 考试/听写/听力成绩
mistake_records(id, kind, at, count, label, item_id, question_json,
                article_id, text)                                         -- 错题本
reading_progress(article_id PK, day, title, at)                           -- 读完记录
writing_records(at, article_id, article_title, model, text,
                feedback_json, task_json, source, sentence_id, exam_id)  -- 仿写历史（v10 补来源）
back_translation_records(id PK, at, article_id, article_title, sentence_id,
                source_zh, context_zh, answer, reference, feedback_json,
                exact, ratio, graded_by)                                  -- 回译存档（v8）
retell_records(at, article_id, text, words)                               -- 复述
activity_days(day, cat, count)                                            -- 每日活动量
study_days(day, seconds, cards)                                           -- 背单词时长/卡数
pick_sessions(at, seconds, picked)                                        -- 选词会话
study_word_days(day, word_id, ordinal)                                    -- 每天背过哪些词（日志用）
skimmed_articles(article_id)                                              -- 精读「略读」进度
kind_stats(article_id, kind, total, correct)                              -- 按篇/题型正确率
answer_events(id, at, day, article_id, source, kind, cat, correct,
              question_id)                                                -- 每题对错（v7，append-only）
golden_drill_records(id PK, at, article_id, article_title, sentence_id,
                     drill_key, fill_first, assemble_first, recall_first,
                     fill_tries, assemble_tries, recall_tries, summary_seen,
                     mastered, completed_at)                              -- D老师小课堂每句进度（v9）
learning_derived_baseline(id=1, payload JSON, at)                         -- v7 迁移前的历史聚合基线
```

- 事实来源就是这些表；`GET /api/store/learning` 读全量，`PUT /api/store/learning` 整份替换（首次补库用），
  `PUT /api/store/learning/partial` 只替换变化的 section（如 `{ practice, kindStats }`），都在一个事务里。
- `writing_records.feedback_json` 自 **契约 v2** 起带 `version: 2`、`issues[]`（含闭集 `rule`、稳定 `key`、
  `severity`）和 `recommendations[]`。旧记录由 `tools/backfill-writing-v2.mjs` 一次性回填（先 `VACUUM INTO`
  备份，再事务更新）；运行时只分析 v2，不再保留旧格式双读。
- 错因复习不新增表：答题事件写 `answer_events`，`question_id = errfix:<rule>|<key>`，
  `source='golden'`、`kind='error-fix'`；Leitner 的到期时间由 `core/writingErrorReview.ts` 从事件现算。- 前端 `localStorage` 仍是**同步缓存**：本地有待同步修改（`reader:learningDirty`）时先补缺失键、
  保留本地，之后由 `useLearningSync` 按 section 防抖写回 SQLite；没有待同步修改时以 SQLite 为准，
  直接覆盖过期缓存，避免旧缓存反过来盖新库。成功写回后才清 dirty；失败保留 dirty，
  按 5s 起、最长 60s 的退避**整份重试**（只重放最后 pending 的 section 会漏掉更早失败的部分），
  服务恢复后不刷新页面也会补写。不重写写作历史/背词日记录等无关表；静态部署/服务不可用时继续只用 localStorage。
- 偏好/会话（主题、字号、面板、上次文章、草稿、会话快照、待选清单、`langCollected`）
  **不进这些表**。
- `reader:activity` / `reader:kindStats` 仍照常写聚合值（兼容现有 UI）；同时每题追加一条
  `answer_events`，字段含 `at / day / articleId / source / kind / cat / correct / questionId`。
  `answer_events` 是 append-only：重复同步按内容 `INSERT OR IGNORE`，整份保存也不会删除已有事件。
  `back_translation_records` 同样是 append-only 的长期学习资产：按 `id` 去重、`INSERT OR REPLACE`，
  整份保存不会清空历史；记录自包含（中文题干 + 答案 + 原句 + 批改），文章删了也能回看。
  v7 迁移时把当时的 `activity` / `kindStats` 存进 `learning_derived_baseline`，
  历史无法逐题重算的部分就是基线；之后 `POST /api/store/learning/rebuild-derived`
  （或直接调用 `sqliteLearning.rebuildLearningDerived`）按「baseline + events」只重建
  `kind_stats`。`activity_days` 保持现有聚合不动：背单词 / 快刷 / 阅读 / 写作 / 跟读只写聚合、
  不产生 `answer_events`，删表重算会把它们静默抹掉；重建结果只用于和本机对账。纯函数口径在 `core/answerEvents.ts`，
  活动日一律用 `core/activity.dayKeyLocal`（事件写入时已落 `day`，服务端不另算日期）。
- v4 迁移：旧词条的 `source.articleId` 存的是文章标题，按 `articles.title` 唯一匹配后换成
  `saved:…` id；`examples[].articleId` / `contexts[].articleId` 一起换。同名/找不到的标题不猜。
- 学习记录没有 JSON 快照表（v5 的 `learning_snapshots` 已退役）：写坏了靠
  `data/backups/` 的每日整库备份回滚，粒度是「一天」；`answer_events` 是 append-only，
  已记录的答题事件不会因为整份保存被删。
- 打开数据库时先 `PRAGMA quick_check`；schema 升级前用 `VACUUM INTO` 把整库备份到
  `data/backups/`（迁移备份保留 5 份）；每天第一次打开已有库再留一份 `xueba-daily-YYYY-MM-DD.db`
  （保留 7 天）。服务长开时每 30 分钟检查一次日期，跨过午夜会自动补当天备份，不用重启。
  备份写完立刻用只读连接 `quick_check`，坏文件删掉重做；当天已有备份在下次检查时也会验，
  发现损坏同样重建，避免“文件名在、内容坏了”。WAL 下用 `synchronous = FULL`，
  断电时宁可慢一点，也不丢最后一笔提交。
- 打开失败（磁盘临时只读、锁冲突、备份失败）不缓存 null，下一次请求会重试，不会一个进程内永久瘫掉。

### 4.4 性能与边界

**2026-10-29 实测**（44 篇 / 9625 词条 / 12 条金句进度）：

| 项 | 数值 | 成本 |
|---|---|---|
| 库文件 | 39.2MB（`-wal` 11.6MB，checkpoint 时回收） | — |
| `vocab.payload` | 15MB JSON → 1.6MB gzip | **解压 + 解析 149ms**（每次读库；保存要解压比对） |
| `articles.payload` 合计 | 1.8MB | 列出全部文章 17ms |
| 学习记录（`golden_drill_records` 12 行） | — | 查询 0.3ms |
| `lang_points` 单篇 33 行 | — | 0.4ms |

- **唯一的大头是词库那一行**：整库一份 JSON，读库 / 保存前的「内容没变就跳过」/ 写快照都要解压它。
  9.6k 条时还宽裕（已有 300ms 合并写 + 5 版快照）。
  **观察线**：词条到 ~3 万、单次保存 >1s、或库 >150MB 时，再考虑把词条/语境/例句拆成事实表；
  别提前拆。看库大小：`curl -s http://localhost:5173/api/store/db` 或直接看 `data/` 目录。
- **不需要提前优化的**：金句（10 句/篇，200 篇 = 2000 句，`golden_drill_records` 有
  `idx_golden_drill_records_article`）、文章正文（按篇查）、学习记录（几万行内都是毫秒级）。
- **客户端先到瓶颈的是渲染，不是 SQL**：全库金句本现在一次渲染所有行，~1000 行没问题；
  到几千行再上虚拟列表（数据层不用改）。金句本已支持按「学习点类型」筛（2026-10-29）。
- 写放大：每次保存会写 JSON + 快照 + 派生表。快照只留 5 版 + 最大一版；每次保存后
  `wal_checkpoint(PASSIVE)`、启动与 `close()` 时 `TRUNCATE`、空闲页占比 ≥ 15% 才 `VACUUM`。
  实测：库 226MB → 51MB，`-wal` 55MB → 0，`data/` 1.4G → 1.2G。
- 文章仍是整篇重建（一篇几十到几百句，成本可控）。词库涨到几万/几十万后，
  下一步是给 `words` / `article_sentences` 建 FTS5。
- `words(lemma)`、`words(updated_at)`、`article_sentences(article_id, ordinal)`、
  `lang_point_terms(text)` 都有索引；复杂查询直接开 `data/xueba.db` 用 SQL：

  ```bash
  sqlite3 data/xueba.db "SELECT word, meaning FROM words WHERE lemma = 'run';"
  sqlite3 data/xueba.db "SELECT s.text, s.translation FROM article_sentences s WHERE s.text LIKE '%recession%';"
  sqlite3 data/xueba.db "SELECT l.sentence_id, t.kind, t.text FROM lang_points l JOIN lang_point_terms t ON t.lang_point_id = l.id;"
  ```

- 写放大：每次保存会写 JSON + 快照 + 派生表（整库 payload 16MB，压缩后快照约 2MB）。
  快照只留 5 版 + 最大一版；每次保存后 `wal_checkpoint(PASSIVE)`、启动与 `close()` 时 `TRUNCATE`、
  空闲页占比 ≥ 15% 才 `VACUUM`。实测：库 226MB → 51MB，`-wal` 55MB → 0，`data/` 1.4G → 1.2G。

## 五、导出 / 备份

| 方式 | 怎么做 | 内容 |
|---|---|---|
| 下载 SQLite 文件 | 浏览器打开 `http://localhost:5173/api/store/db`，或 `curl -OJ http://localhost:5173/api/store/db` | 用 `VACUUM INTO` 生成的一致性快照（含 WAL 中已提交数据），可用 DB Browser / `sqlite3` 打开 |
| 导出 JSON | `GET /api/store/export`（加 `?download=1` 直接下载） | 词库 + 快照 + 文章 + 学习记录（完整 section） |
| 应用内「导出全部（备份）」 | 侧栏按钮 | 词库 + 文章 + 练习/错题/活动/写作/复述/背词日/略读/题型统计；导入/合并会把它们一起恢复 |
| 应用内「导出批改」 | 侧栏按钮（`writingHistoryToMarkdown`） | 仿写 / 金句课单句 / 金句课考试的 **AI 批改**（分数、逐条问题、润色、总评）按时间倒序成一份 Markdown；这些批改平时只在交卷时显示，导出后才算留档 |
| 应用内「文章包」（单篇 / 多篇） | 打印 / 导出面板「🗂 文章包 JSON」（范围选「本篇」或「按文章」） | 正文 + AI 结果（翻译/语法/语言点/生词/搭配/金句课）+ 这篇的词条与按篇收录 + 能归属到这篇的学习记录（练习/错题/读完/写作/回译/复述/略读/答题事件/金句进度）。另一台电脑用「合并导入」；**覆盖导入会拒绝**（否则整库只剩这一篇）。活动/学习时长等全局统计不随单篇走 |

**合并导入的落盘顺序不能反**：文章 → 词库（`persistNow` 等真正成功）→ 学习记录 → 最后才写
`reader:importedBackups` 指纹。词库 409 / 断网时不能记指纹，否则同一份文件再导入会被去重直接跳过，
而数据其实没进来。覆盖导入同理：词库落盘失败时不改学习记录，保持原样可重试。
| 历史词库 | `GET /api/store/vocab/snapshots` / `GET /api/store/vocab/snapshots/:at` | 最近 5 版 + 历史最大一版；只留接口，界面无退版入口 |

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
      ↓ 只依赖 core/ports.ts（VocabRepoPort / ArticleRepoPort / LearningRepoPort / TakeRepoPort…）
HybridRepo / LearningRepo（adapters：SQLite 优先，IndexedDB/localStorage 兜底）
      ↓ HTTP /api/store/*
server/storeApi.js（路由，不认识具体 DB）
      ↓ 同一组方法：loadVocab / saveVocab / listArticles / saveArticle / loadLearning / saveLearning…
server/sqliteStore.js（词库/文章/快照/导出）
server/sqliteLearning.js（学习记录 section 读写）
server/sqliteBackup.js（迁移前 / 每日整库备份）
server/sqliteUtil.js（事务与字段转换）
```

所以：

- **UI / hooks 不直接碰 SQL、不直接 fetch `/api/store`**；换 DB 不动视图。
- 换到 Postgres / MySQL 时，主要写一个新的 `server/pgStore.js`，保持
  `loadVocab / saveVocab / listSnapshots / listArticles / saveArticle / removeArticle /
  exportAll / checkpoint` 这组方法签名，然后让 `storeApi.js` 改用它。
- 前端 `HybridRepo` 不需要改：它只认 HTTP 契约和 `/api/store/health`。
- **不是“零成本”**：`sqliteStore.js` 里的 `PRAGMA user_version`、`INSERT OR REPLACE`、
  `wal_checkpoint`、JSON 列都是 SQLite 方言；派生表的 SQL 大部分是标准 SQL，但迁移脚本要重写。
- 端口是**领域仓储**，不是通用 CRUD 生成器：词库、文章、录音各有自己的语义；
  这比“一个万能 KV 表”更难被某个 DB 绑死，也更能保证业务约束。
- 录音（`TakeRepoPort`）和校准/改文本目前还是 IndexedDB / localStorage：
  换 DB 时它们是下一批要补的端口实现。

## 八、下一阶段（还没做）

0. **学习记录已迁 SQLite（v3 建表，v4 修旧 id）**：练习、错题、读完/精读、写作、复述、活动、背词/选词记录
   已落表；`learning_snapshots`（v5）和 `article_prev`（v6）**已退役**，写前不再留整份快照，
   回滚粒度就是 `data/backups/` 的每日整库备份。下一步把“答题明细”从聚合值改成事件表，
   让 `activity` / `kindStats` 可重算，而不是只保存结果。
0.1 **已知数据债（先不动）**：`A long road` 有两篇（`saved:1791421783707` / `saved:1791119917875`），
   正文 94% 重合但**分句边界不同**（旧版把标题和第一句并成一句），按句子 id 合并会把语境指错句；
   2026-10-29 决定先留着（保留 10-14 那篇，另一篇当历史）。真要处理只能按 lemma 并按篇条目、
   句子 id 留空后再删。
1. **录音迁到服务端**：`data/takes/<id>.bin` + SQLite 元数据（`file_name` 索引），
   前端 `HybridTakeRepo`；第一次打开某篇时把该篇旧录音补传。
2. **校准 / 改文本**：接口是同步的，迁 SQLite 要改成异步；数据很小，优先级低。
3. **FTS5 全文搜索**：词库/文章上 SQLite FTS，替代前端内存过滤。
4. **多设备**：SQLite 文件放同步盘或加一个导出/导入入口；不做账号系统。
