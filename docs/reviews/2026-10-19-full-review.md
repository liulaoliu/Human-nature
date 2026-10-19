# 全库 Review（2026-10-19）

> 范围：`src/**`、`server/**`、`tools/**`、`docs/**`；基线 commit `a6af8ec`。
> 方法：`docs/CODE-REVIEW.md` 的 A–G 七维度；证据均已 `read` 复核。
> 默认只报不改；P0/P1 优先修。修复后在对应条目前打勾。

## 一、基线

- `npm run gates`：修复 3 个测试文件的 localStorage 环境问题后**全绿**（72 个测试文件，944 项通过 / 1 跳过）。
- 上帝文件基线：`ReaderApp.tsx` 3020 / 3021，`ui/App.tsx` 1191 / 1192，`state/session.ts` 1185 / 1186，`core/vocab.ts` 1122 / 1123。
- 测试覆盖：core 103 个模块有同名测试；hooks **5 / 23**、panels **4 / 25** 有测试；无 `ReaderApp` 级集成测试。

## 二、结论

底层（core / ports / adapters / server）仍是这个项目最值钱的部分，问题集中在**接线层**：

1. **词库出现了第二个「读库 → 写库」的 effect**，与 `useLibraryAutoFill` 在同一个提交里从同一份快照写入 —— 正是 `docs/TESTING.md` 踩坑 #1 的翻版，有再次丢数据的风险（P0）。
2. `ReaderApp`（3020 行）+ `useApplyTaskResult`（499 行、一条 if 链）+ `useExport`（27 个参数）是三个「所有功能都往这里塞」的汇聚点，是后续每次改动的成本来源（P1）。
3. 学习记录同步、HybridRepo、外部 JSON 导入都有「结构上允许出错」的地方（静默失败、模式锁死、无运行时校验），比单个 bug 更值得先修（P1）。
4. 不需要推倒重来：core/adapters 保留，按「先唯一写入口 → 再拆会话 → 最后拆渲染」的顺序做外科手术。

## 三、问题清单

### P0

| # | 维度 | 位置 | 问题 | 修法 |
|---|---|---|---|---|
| 1 ✅ | A/B | `src/reader/ReaderApp.tsx:2115-2122`；`src/reader/hooks/useLibraryAutoFill.ts:88-98` | **词库双写入口**：`useLibraryAutoFill` 的 effect 用 `libraryRef` 写库；`ReaderApp` 的「离线词典归原形」effect 又用**本渲染的 `library` 快照**写库。两个 effect 同一次提交按声明顺序执行，后者会把前者刚加的语言点/例句覆盖掉，而 `langCollected` 已被标记为「收过」，丢的条目不会自己回来。 | 把词典归原形并进 `core/libraryAutoFill.ts` 的计划（新增一格 `dictLemmaPairs`），只由 `useLibraryAutoFill` 一个 effect 调 `persist`；删掉 `ReaderApp` 里这个 effect。补一条 hook 测试：同一提交内 autofill 与词典归一同时命中时，最终词库是两者并集。 |

### P1

| # | 维度 | 位置 | 问题 | 修法 |
|---|---|---|---|---|
| 2 🟡 | A | `src/reader/ReaderApp.tsx`（3020 行；35 `useState`、12 `useEffect`、48 `useCallback`） | 仍是「状态总线 + 所有面板 props 接线」。状态声明与面板参数互相牵扯，改一个交互要动多处；渲染段约 750 行。 | 分三步：①把学习记录状态（practice/mistakes/activity/studyDays/sessions/…）收进 `useLearningData`，对外只暴露 `data + actions`；②把 `ReaderApp` 按视图拆成 `ReaderShell`（工具栏+正文+侧栏）与 `SessionHost`（各练习面板路由）；③最后把 `reader:batch`、`reader:last` 等散落 IO 移进对应 hook。验收：`ReaderApp` ≤ 1200 行，行为不变。 |
| 3 ✅ | A | `src/reader/hooks/useApplyTaskResult.ts:116-499`；`ReaderApp.tsx:1711-1777` | 一个 499 行 callback + 12 种任务的 `if` 链；`copyMissingAgain` 又把 5 个分支的「取词 → 组 prompt → setLastTask」复制了一遍。新增一种 AI 任务要改 3 处。 | 按 `patrol_helper` 的「一种任务 = 一个对象」重构：`interface AiTask { kind, parse(raw), apply(data, ctx), buildReprompt(words, ctx), report(data) }`，注册表 `TASKS`；`applyTaskResult` 只做 `TASKS[task].parse/apply`。先补 `useApplyTaskResult` 的 12 条表驱动测试再动。 |
| 4 ✅ | A | `src/reader/hooks/useExport.ts:100-146` | 27 个参数（数据 17 个 + setter 13 个），导入/合并/导出全部挤在一个 hook；`parseBackupPayload` 用 `as` 直接相信文件内容（`useExport.ts:42-75`）。 | 抽 `useLearningData`（见 #2）后，这里只收一个 `data` 对象 + 一个 `replace/merge` action；解析层加运行时守卫（见 #7）。 |
| 5 ✅ | B | `src/reader/hooks/useLearningSync.ts:24-109`；`src/reader/learningState.ts:50-59`；`src/core/ports.ts:213-216`；`src/adapters/learningRepo.ts:65` | 同步引擎是一个 85 行的 effect + 模块级 `serverChecked/dirtySeq` 可变状态；`LearningRepoPort` 只声明 `load/save`，但调用方用了 `savePartial/migrate`，且 hook/状态层直接 import 具体单例 `learningRepo`，无法注入假实现。 | 抽 `core/learningSync.ts`：纯状态机（`note(section)`、`flush(now)`、`retryDelay`）+ 注入 `LearningRepoPort`；effect 只负责订阅事件和调 `engine.flush()`。端口补齐 `savePartial/migrate`，`learningState` 改为接收 repo 参数（默认单例）。这样定时器/退避/离线重试可以纯单测。 |
| 6 ✅ | B | `src/reader/hooks/useVocabLibrary.ts:67,90,103`；`src/adapters/vocabRepo.ts:259`；`src/adapters/articleRepo.ts:176` | 词库/文章的落盘失败被 `.catch(() => {})` 吞掉：用户看到「已保存」，刷新后却回到旧版；镜像写失败也完全不可见。 | 统一错误通道：`persist` 返回 `Promise<boolean>` 或触发 `onWriteError`；`useVocabLibrary` 在失败时 `flash('保存失败，已保留上一版')`；镜像失败至少 `console.warn` 并记一个可重试标记。补一条「仓储 save reject → 用户可见提示」的 hook 测试。 |
| 7 ✅ | B/G | `src/reader/hooks/useExport.ts:42-75`；`src/core/mergeBackup.ts:23-28`；`src/core/learning.ts:90-146` | 外部备份/结果文件只做 `Array.isArray` + `as`，随后直接进 `mergeLibraries/dedupeLibrary`。缺 `lemma/createdAt/reviewState` 的条目会让合并结果出现 `undefined` 键或运行时异常；`normalizeLearning` 也只校验少数字段。 | 在 `core/` 加 `parseBackup(data): { data, errors }` 运行时守卫（逐字段检查 + 丢弃坏条目 + 汇报条数）；`mergeLibraries` 前先跑一遍 `migrateLibrary`。补「缺字段/类型错/空数组」的测试。 |
| 8 ✅ | G | `server/storeApi.js:82`；`server/httpApp.js:137-154`；`tools/ai-core.mjs`、`tools/tts-core.mjs` | 只有 `/api/store` 的非 GET 校验同源；`/api/ai/*`（会花 API 额度）、`/api/tts*`（会写缓存）、`/__state`（会写文件）没有 Origin 校验。任意网页都能对本机 127.0.0.1 发起简单请求。 | 抽 `server/sameOrigin.js`，所有非 GET（含 `/api/ai/run`、`/api/tts` 缓存预热、`/__state`）统一校验；`/api/tts` 的 GET 也建议校验 `Sec-Fetch-Site` 或 Origin。补 server 测试：`Origin: http://evil.test` → 403。 |
| 9 🟡 | C | `src/reader/hooks/**`、`src/reader/panels/**` | 23 个 hook 只有 5 个有测试，25 个 panel 只有 4 个；`useApplyTaskResult`、`useQuizSession`、`useDictation`、`useSpeaking`、`useAiPack`、`useExport` 全部裸奔。上面的重构没有安全网。 | 重构前先补「接线级」测试：每个待拆 hook 至少覆盖「初始态 / 成功 / 失败 / 卸载清理」；`ReaderApp` 加一条假仓储的挂载测试（自动补全只写一次、导入备份不重不漏）。 |

### P2

| # | 维度 | 位置 | 问题 | 修法 |
|---|---|---|---|---|
| 10 ✅ | B | `src/adapters/vocabRepo.ts:225-230`；`articleRepo.ts:118-123` | `HybridRepo` 的 `mode` 一旦因一次失败变成 `local`，本次会话**永不重试 SQLite**；服务恢复后新数据只写 IndexedDB，直到刷新。 | 失败后按退避重探（如 30s），或每次 `save/load` 前在 `local` 模式下用 `storeHealth()` 轻量重试；与 `useLearningSync` 的退避策略统一。 |
| 11 🟡 | B/E | `server/sqliteStore.js:568-593`；`server/sqliteLearning.js:344-350`；`src/adapters/vocabRepo.ts:59-104` | 每次保存词库都 `clear + rebuild` 全部派生表（7k+ 词）；每次保存学习记录都先整份 `loadLearning` 做快照；每次词库保存都遍历所有快照找最大。交互一次 = 多次全量 IO。 | 词库保存按 `updatedAt` 做增量 upsert（或至少 debounce 200–500ms 合并同一轮连点）；快照比较用 `item_count`/hash 而非整份 JSON；快照瘦身改成只维护元信息。 |
| 12 ✅ | B | `src/adapters/articleRepo.ts:125-146` | `list()` 是读接口，却在里面逐篇 `PUT` 回写本地较新的文章，失败还会把整个 repo 切成 `local`；文章多时是 N+1 次网络请求。 | 把「本地补迁」移到显式的 `reconcile()`（启动时一次），`list` 只读；补迁用批量接口或并发上限。 |
| 13 ✅ | D | `server/storeApi.js:255,278`；`server/sqliteBackup.js:83` | 服务端导出文件名/每日备份用 UTC 日期；客户端统一用 `dayKeyLocal`（04:00 本地结算）。中国时区 0–8 点导出的文件会标成前一天。 | 服务端加 `localDayKey()`（本地时区，必要时统一 04:00 逻辑）；导出文件名与客户端同口径。 |
| 14 ✅ | D | `src/core/mergeBackup.ts:48-71` | `mergeStudyDays`/`mergeActivity` 是**累加**语义：同一份备份「合并导入」两次，学习时长/活动次数翻倍；而 sessions/practice/writing/retells/mistakes 都做了去重。`docs/TESTING.md` §4 却写着「同一份备份合并导入两次不重复计数」。 | 要么给学习日/活动记录加来源标识做幂等，要么在 UI 明确提示「按天累加，重复导入会翻倍」，并修正文档口径。两者选一，别让文档和实现对不上。 |
| 15 ✅ | E | `src/reader` 9 处 `addEventListener('keydown')`（`ReaderApp:601,1207,1398`、`useDictation:478`、`useQuickSession:83`、`useQuizSession:486`、`useStudySession:486`、`StudyPanel:235`、`SpeedReadPanel:474`） | 每个模式各自挂全局键盘监听，靠内部判断「当前是不是我」；新增模式容易忘屏蔽旧模式，出现一次按键触发两个动作。 | 抽一个 `useHotkeys(scope, map, enabled)` 或集中 `keyboard.ts`，按当前 `examActive/studyQueue/...` 只启用一个 scope；补一条「考试中按 Q 不会切背单词」的测试。 |
| 16 ✅ | B | `server/sqliteStore.js:419-454` | 每个 `PRAGMA user_version = N` 在迁移事务**提交之后**执行；若进程在之间退出，迁移会再跑一遍。当前各步恰好幂等，但这是「靠运气」的原子性。 | 把 `PRAGMA user_version = N` 放进同一个 `tx()`（SQLite 支持事务内改 user_version），一次性提交。 |
| 17 ✅ | A | `src/reader/dictionary.ts`、`src/reader/tatoeba.ts`、`src/core/dictionary.ts` | `fetch/加载` 散在 reader 与 core；`ARCHITECTURE.md` 只把 `core/dictionary.ts` 登记为 TODO，`reader/dictionary.ts`/`tatoeba.ts` 没登记。 | 统一搬到 `adapters/`，reader 只注入接口；顺手把 `core/dictionary.ts` 的 TODO 清掉。 |
| 18 🟡 | E | 全库 179 处 `catch {}` | 多数是「隐私模式/可选功能」的有意降级，但 IO 路径与 UI 路径混在一起，无法区分「可忽略」和「出事了」。 | 分两类：可选能力保留空 catch 并加注释；用户资产 IO 一律 `console.warn` + 可见提示（与 #6 合并做）。 |

### P3

| # | 维度 | 位置 | 问题 |
|---|---|---|---|
| 19 | A | `SpeedReadPanel.tsx` 778、`StudyPanel.tsx` 744、`useSpeaking.ts` 592、`useQuizSession.ts` 537、`useStudySession.ts` 543 | 已接近 800 行门禁；下次加功能很容易超限。建议先把「渲染块」和「会话状态机」分开，别等门禁失败再拆。 |
| 20 | A | `src/ui/App.tsx` 1191、`src/state/session.ts` 1185 | 旧跟读模块，已登记豁免。除非要继续开发跟读，否则别动；要动先补测试。 |
| 21 🟡 | F | `src/reader` 281 个 `onClick` vs 3 个 `aria-*`/`role` | 键盘可达性主要靠全局快捷键；纯鼠标交互（划词、悬浮气泡）没有无障碍标签。不是当前重构重点，改面板时顺手补 `aria-label`。 |
| 22 ✅ | G | `server/storeApi.js:94-101` | `/health` 回传数据库绝对路径；本机服务问题不大，但日志/截图分享时会泄露目录结构。建议只回 `engine/version`。 |

## 四、修复记录（2026-10-19 收尾）

- P0/P1 数据风险全部关闭：词库单一写入口、写盘失败可见、备份运行时守卫、服务端同源校验、学习同步状态机。
- 会话层：`useLearningData` 收口 12 类学习记录；`useExport` 参数 30 → 11；AI 结果应用改任务注册表并补 13 条表驱动测试。
- IO/键盘：词典与例句加载器搬到 `adapters/`；混合仓储支持重探 SQLite、文章读接口去掉写副作用；全局键盘按优先级集中分发。
- 服务端：迁移版本号与 DDL 同事务、导出日期改本地日、健康接口去掉绝对路径、重复词库保存与增量快照降 IO。
- 仍未完成：`ReaderApp` 2930 行（目标 ≤1200，渲染层尚未拆）、hook/panel 测试覆盖仍不足、面板接近 800 行、个别 `catch {}` 未逐条分类、aria 只做了键盘入口。

## 五、重构路线（每步可单独提交）

**阶段 0（已完成）**
- [x] 修 3 个测试文件的 localStorage 环境问题，`npm run gates` 恢复全绿。
- [x] 固化 Review 流程（`docs/CODE-REVIEW.md`）与文档索引。

**阶段 1：先堵数据风险（P0/P1）**
- [x] 合并词库双写入口（#1）——先写失败测试，再删 effect。
- [x] 落盘失败可见化（#6）+ 外部 JSON 运行时守卫（#7）。
- [x] 服务端统一同源校验（#8）。
- [x] `useLearningSync` 抽纯状态机 + 端口补齐（#5）。
- 验收：`npm run gates` 全绿；新增「双写/坏备份/跨站写」测试各 ≥1。

**阶段 2：拆会话层（收益最大）**
- [x] `useLearningData` 收口 11 类学习记录（#2 第①步 / #4）。
- [x] `useApplyTaskResult` 改任务注册表（#3）+ 表驱动测试（#9）。
- [x] `useExport` 去掉 27 参数（#4）。
- 验收：`ReaderApp` 降到 ≤ 2000 行；行为不变；AI 任务新增只改一个文件。

**阶段 3：拆渲染与 IO**
- [ ] `ReaderShell` / `SessionHost` 拆分（#2 第②步）。
- [x] 散落 localStorage / fetch 迁到 hooks/adapters（词典/例句加载器）（#17）。
- [x] 键盘集中管理（#15）。
- 验收：`ReaderApp` ≤ 1200 行；`SpeedReadPanel`/`StudyPanel` < 600 行。

**阶段 4：性能与口径**
- [ ] HybridRepo 重探与 `list()` 去副作用（#10/#12）。
- [ ] 词库/学习记录增量写与快照瘦身（#11）。
- [ ] 服务端本地日期口径（#13）；合并导入幂等或明确提示（#14）。

## 五、人工验证（自动化覆盖不到）

| 场景 | 步骤 | 通过标准 |
|---|---|---|
| 词库双写修复 | 打开一篇有语言点的文章，等词典/例句就绪 | 语言点与离线例句都进库；刷新后不消失；控制台无写库错误 |
| 写库失败提示 | 停掉本地服务，改一个词条 | 出现「保存失败」类提示；恢复服务后改动仍在或可重试 |
| 坏备份导入 | 手工删掉备份里某个词条的 `lemma` 后导入 | 提示跳过 N 条坏数据，应用不崩、现有词库不被清空 |
| 跨站写拦截 | 从另一个源向 `localhost:5173/api/ai/run` POST | 返回 403，不产生 AI 调用/文件写入 |
| 学习记录离线重试 | 停服务答题 → 起服务不刷新 | 约 5–10s 内补写 SQLite；`reader:learningDirty` 清空 |
| 合并导入两次 | 同一份备份连续「合并导入」两次 | 练习/错题/写作/复述不翻倍；学习时长/活动按当前口径（累加或去重）有明确提示 |
| ReaderApp 拆分回归 | 逐项走：阅读、选词、背单词、考试、听写、听力、仿写、统计、导出 | 与拆分前一致；无重复快捷键触发 |
