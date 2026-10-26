# 数据模型（表 / 键 / 不变量 / 迁移）

> 这份文档补的是过去缺的一课：**先定数据结构再写功能**。
> 之前是「用到再加字段」，结果同一个概念有几种形状（日期键 4 种算法、`used`/`use` 两种原形、
> 语言点键取到英文单词…），出过一次**丢 7694 词**的事故。这里把现状写清，改结构前先读它。

## 一、存储位置总览

| 存什么 | 存哪 | 谁写 | 备注 |
|---|---|---|---|
| **词库**（词条：单词 / 词组 / 习语 / 用法笔记） | SQLite `data/xueba.db`；IndexedDB `shadowing-vocab` 兜底 | `adapters/vocabRepo`（Hybrid） | 每次保存留历史快照；见 `docs/STORAGE.md` |
| **文章**（正文、句子、翻译、语言点、每句 `vocab`） | SQLite `data/xueba.db`；IndexedDB `shadowing-reader` 兜底 | `adapters/articleRepo`（Hybrid） | 派生表可 JOIN；坏库可用「导出全部」再导入 |
| 待选清单（自动标词的结果，按篇） | localStorage `reader:batch` | `ReaderApp` / 各会话 hook | `{ [articleId]: {word, sentence, sentenceId}[] }` —— **找回词库最准的一手数据** |
| 错题本 | SQLite `mistake_records`；localStorage `reader:mistakes` 缓存 | 各练习 hook + `useLearningSync` | `itemId` 形如 `vocab:run` |
| 读完 / 精读进度 | SQLite `reading_progress` / `skimmed_articles`；localStorage 缓存 | `hooks/useReadDone` + `useLearningSync` | 按逻辑日（04:00 结算） |
| 学习活动 / 日志 / 练习 / 打卡 | SQLite `activity_days` / `practice_records` / `study_word_days` 等；localStorage 缓存 | 各 hook + `useLearningSync` | **日志是 `core/journal` 算出来的视图**，不是独立表 |
| 语言点「已收过」记账 | localStorage `reader:langCollected` | `hooks/useLibraryAutoFill` | 可重建缓存；清空 = 从文章重收一遍 |

> 分类原则见 `docs/STORAGE.md` §2.1：偏好/会话留 localStorage；学习记录进 SQLite；
> 不要把所有 `reader:*` 镜像成万能 KV 表。

## 二、核心结构（`src/types/document.ts`）

```
VocabLibrary {
  schemaVersion, items: VocabItem[], articleEntries?,
  sentenceTexts?: { [articleId|sentenceId]: string },
  tombstones?: { kind: 'item'|'article', key, at, lemma? }[]
}
VocabItem {
  id: `vocab:${lemma}`；word/lemma；kind?: 'word'|'phrase'|'idiom'|'usage'；langPointId?
  phonetic/partOfSpeech/meaning/definition/grammarMarks
  fieldSources?: { phonetic/partOfSpeech/meaning/definition: 'ai'|'dict'|'manual' }
  usage[]；phrases?[]；idioms?[]；examples[]；confusables?；confusablesSource?: 'ai'|'dict'
  source?: { articleId, fileName, sentenceId, sentenceText }
  contexts?: { articleId, fileName, sentenceId, sentenceText, meaning?, at }[]
  status: 'unqueried'|'queried'|'edited'|'mastered'
  note/tags/lastPrintedAt?/priorityUntil?/reviewState/createdAt/updatedAt
}
Sentence { id, paraId, text, audio, translation, grammarNote, collocations, vocab[], language?/languages[] … }
SentenceLanguage { structure?/grammar?/idioms?[]/phrases?[]/usage?[]/source?/at? }
SavedArticle {
  id/title/book?/sourceKey/text/paragraphs/sentences/createdAt?/updatedAt
  origin?: 'library'|'paste'|'epub'|'file'   // 旧数据没有 → 未知，不按 sourceKey 猜
  // createdAt 首次建立时间；老数据没有时用 updatedAt 兜底。自动保存不能改它。
}
```

## 三、不变量（`core/libraryValidate.ts` 里可执行）

**error（必须成立）**
1. `id` 非空且唯一；`word`/`lemma` 非空；**`lemma` 全库唯一**（去重与合并都靠它）。
2. `kind` 只能是那 4 个值；`status` 只能是那 4 个值。
3. `createdAt`/`updatedAt` 是 ISO；`reviewState` 三个数值字段齐全（`due` 可为 null）。

**warn（可疑）**
4. `id !== vocab:${lemma}`（改名后没同步 id）；例句缺 `text`；`source.articleId` 为空；语境缺 `articleId`。

**口子约定**
5. 单词的 `kind` 是 `undefined`（不写 'word'）；词组/习语/用法必须是那 3 个之一 —— 显示层与 AI 任务都按这个分流。
   词形本身是**单个英文单词**时例外：`kindOf` 一律按单词算（AI 有时把单词写进「用法 / 词组」栏，存量数据也可能被误标）。
6. 语言点条目的去重键：词组/习语按 `lemmaOf`，用法笔记按**整条文本**（`textKey`），单字词按单词处理。
7. 日期一律走 `core/activity`：`dayKeyLocal`（逻辑日，04:00 结算）/ `calendarDayKey`（日历日）。

## 四、迁移（`core/migrations.ts`，唯一收口）

- 加载时只调一次 `migrateLibrary(raw)`：**逐条宽容解析 → 修早先误标的类型 → 按词性过滤语法标记 → 按 lemma 去重**；幂等。
- 破坏性变更：升 `SCHEMA_VERSION` + 在 `migrateToCurrent` 里补一步 `migrateVnToVn+1`，并补迁移测试（老样本 → 新结构）。
- 修不出来的条目**丢弃而不是崩溃**（丢一条 > 整个库读不出来）。

## 五、数据安全的四条铁律

见 `docs/ARCHITECTURE.md` §三·五：**单写入口 / 读成功才写 / 覆盖前留快照 / 同一份事实存多份**。
新增任何「用户资产」先问：**它还有第二份吗？**
