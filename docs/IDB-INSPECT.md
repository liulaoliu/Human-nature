# 排查浏览器 IndexedDB（词库 / SRS）

> 一句话：先跑 `node tools/inspect-idb.mjs`，**不要再临时写 Chrome/CDP 脚本**。
> 工具只读原库；它读的是浏览器里真实的兜底库，不是 `data/xueba.db`。

## 什么时候用

- SQLite 里的词库看起来是旧的（`vocab.updated_at` / `words.updated_at` 停在某天），
  但页面里还有最近的复习记录。
- 只起了 `npm run dev`（Vite），没起 `npm run serve`（`server/appServer.ts`）：
  `HybridVocabRepo` 会回退到 IndexedDB，SQLite 不会收到这次会话的写入。
- 怀疑某个词 `reviewState.interval` / `due` 被指数级放大，或者按文章找不到词。
- DevTools → Application → IndexedDB 里整库 JSON 太大，翻不动。

## 常用命令

```bash
# 词库概况：条数、interval 最大的词、可疑 SRS
node tools/inspect-idb.mjs

# 多看几条；interval >= 100 视为可疑
node tools/inspect-idb.mjs --limit 50 --min-interval 100

# 精确查一个词（word / lemma 都匹配）
node tools/inspect-idb.mjs --word commodity

# 按文章筛：文章里已复习过的词 + 按来源/语境直接命中的词
node tools/inspect-idb.mjs --article saved:1794319050768 --limit 30

# 顺带看最近 3 版词库快照（只返回摘要，不传整库）
node tools/inspect-idb.mjs --snapshots 3

# 列出所有 IndexedDB 和 object store
node tools/inspect-idb.mjs --list

# 读 Edge / 换端口 / 换 Chrome profile
node tools/inspect-idb.mjs --browser edge
node tools/inspect-idb.mjs --origin http://localhost:5174
node tools/inspect-idb.mjs --profile "Profile 1"

# 机器可读
node tools/inspect-idb.mjs --json > idb.json
```

参数全表在 `node tools/inspect-idb.mjs --help`。

## 输出怎么读

| 字段 | 含义 |
|---|---|
| `items` | `library.items` 条数；词库按 lemma 去重后的全部词条 |
| `articleEntries` | 按篇收录的条目总数（全库） |
| `suspicious` | `interval >= --min-interval`，或 `due` 超过当前年份 + 5 年 |
| `top` | `interval` 最大的词 |
| `wordMatches` | `--word` 的精确匹配（word 或 lemma） |
| `article.direct` | `source.articleId` 或 `contexts[].articleId` 命中该文章 |
| `article.reviewed` | 文章句子 lemma 命中、且 `repetitions > 0` 的词 |
| `article.entriesCount` | 该文章的 `articleEntries` 数量 |
| `snapshots` | 最近 n 版快照的条数 / 可疑数 / top3 |

`reviewState` 的字段：

- `ease`：难度系数，默认 2.5；
- `interval`：下次间隔（天）；
- `due`：下次到期时间（ISO）；
- `repetitions`：连续答对次数；
- `lapses`：遗忘次数；
- `relearn`：重学状态（如果有）。

**指数级 bug 的特征**：`interval` 每评一次就乘一次 `ease`（见
`src/core/vocab/review.ts`）。一个刚学不久的词如果出现几百/几千天，基本就是被反复评分了。
代码修复只能阻止**新的**放大；已经写大的 `reviewState` 不会自动回滚，需要在应用里重置该词，
或另写一次性修数据脚本（不要手改 LevelDB）。

## 它怎么工作

1. 找到 `<User Data>/<Profile>/IndexedDB/<origin>.indexeddb.leveldb`，以及**同名**
   `<origin>.indexeddb.blob`。
2. 两个目录一起复制到临时 profile（默认 `I:/.cache/temp/opencode`，可用
   `INSPECT_IDB_TMP` 覆盖）。
3. 起一个 headless Chrome/Edge，导航到**同 origin** 的页面：
   - dev server 已经在跑 → 直接用它；
   - 没跑 → 工具在同一个端口起一个空白 HTTP 服务（只支持 `http://`）。
4. 用 CDP 在页面里 `indexedDB.open(...)`，只把摘要数据传回来。
5. 关掉浏览器、删临时 profile；**原 profile 不动**。

## 坑（按踩过的顺序）

1. **只拷 `*.indexeddb.leveldb` 会报 `NotReadableError: Data lost due to missing file`。**
   Chrome 的 IndexedDB 是 `leveldb` + `blob` 两个目录；大值存在 blob 里。两个都要拷。
2. **IndexedDB 按 origin 隔离。** `localhost:5173`、`127.0.0.1:5173`、`localhost:5174`
   是三套库。用 `--origin` 指定；端口别猜。
3. **Chrome profile 不一定是 `Default`。** 用 `--profile "Profile 1"`；Edge 用 `--browser edge`。
4. **浏览器开着时复制，可能拿到几分钟前的快照，偶尔会不一致。**
   工具遇到 `Data lost` 会自动重试 3 次；还失败就关掉页面/浏览器再跑。
5. **不要 `getAll()` 整个 `snapshots` store。** 几版快照加起来几十 MB，经 CDP 序列化会卡死。
   工具只取最近 n 个 key，并在页面里先算好摘要；默认 `--snapshots 0` 完全不读快照。
6. **`indexedDB.open()` 在库不存在时会新建一个空库。** 工具先查 `indexedDB.databases()`，
   不存在就报 `DB_NOT_FOUND`，不会误建。
7. **临时 profile 含用户数据**（cookie / 本地存储的副本）。默认用完即删；`--keep` 只用于调试，
   别把临时目录提交进仓库。
8. **需要 Node ≥ 23.6**：原生跑 `.ts`（`lemmaOf`）和 `node:sqlite`；不需要 `npm install`。

## 和 SQLite 的关系

SQLite 是主存，`data/xueba.db` 里：

- `vocab.payload`：完整词库 JSON（gzip），是事实来源；
- `words`：从 `items` 展开的派生表，`review_interval` / `review_due` 可以直接 SQL 排序。

```sql
SELECT word, review_interval, review_due, review_repetitions, updated_at
FROM words
ORDER BY review_interval DESC
LIMIT 20;
```

但如果 `vocab.updated_at` 停在旧日期、服务又没起，SQLite 就看不到这次会话的复习；
这时用 `tools/inspect-idb.mjs` 读浏览器的兜底库。两边都查一遍，才能判断是“没写进 SQLite”
还是“SRS 真的被写大了”。

## 2026-11-11 的排查记录

- SQLite：`words.review_interval` 最大 38（`mistake` / `outfit`），目标文章
  `saved:1794319050768` 没有对应 `words` 行；`vocab.updated_at` 停在 11-07。
- IndexedDB（本工具）：`items=10604`，最大 interval 38，可疑 0 条；
  目标文章 `articleEntries=0`，文章词里已复习的只命中几个旧词（如 `commodity` / `rally` / `fund`）；
  最近快照（11-07）同样是最大 38。
- 结论：当时没有找到“被写大到几百/几千天”的持久化记录。可能是 bug 发生前/后状态已被重置，
  或者那次复习没有成功落盘。代码修复（`useStudySequence` / `useStudyHotkeys`）仍然保留，
  用来阻止再次发生；**不要因为查不到就回滚修复**。

## 给 AI agent 的提醒

- 需要看 IndexedDB 时，先跑这个工具；缺能力就**扩展这个工具**，不要每次重新写一套
  `chrome --headless` + CDP + 临时脚本。
- 改完工具同步改本文档；如果新增了坑，在 `docs/TESTING.md` §3 也补一条。
- 查库结论要写进最终回复：查了哪个库、多少条、最大 interval、有没有可疑项。
