# 交接记录（2026-10-20）

给明天 / 换电脑继续用。**多标签页冲突仍然明确不做**，用户只开一个标签页。

## 当前状态

- 分支：`main`
- 本轮最后提交：`6a13c8d fix: 答题事件同步保持 append-only（去重且不删除）`
- 工作树：干净，已 push 到 `origin/main`
- schema：`PRAGMA user_version = 7`
- 门禁：`npm run gates` 全绿（173 个测试文件，**1555 passed / 5 skipped** + tsc + 上帝文件 + 架构 R1–R7）
- 实时库：`data/xueba.db`（本地，不进 git）

## 这轮补了什么

1. **词库逻辑拆分**：`core/vocab.ts` 1122 行 → 20 行 facade，实现拆到
   `core/vocab/{word,merge,analysis,library,review}.ts`；102 条原测试按子模块搬走，基线销账。
2. **大文件继续拆分**：`useSpeaking` → `useTtsPlayback` + `useTtsPrefetch`；
   `SidePick` → 三个子面板；速读拆 `useSpeedReadWords` / `useSpeedReadSession`；
   背单词拆 `useStudyPool` / `useStudyTimers` / `useStudyCardEdit` + 三个子组件。
3. **答题事件表（schema v7，P1 架构债已完成）**
   - 新增 append-only `answer_events`：考试 / 听写 / 听力每题记
     `at / day / articleId / source / kind / cat / correct / questionId`。
   - 前端 `useLearningData.recordAnswer` 统一追加；备份导出 / 覆盖导入 / 合并导入都包含事件。
   - v7 迁移把历史 `activity` / `kindStats` 存进 `learning_derived_baseline`；
     `POST /api/store/learning/rebuild-derived` 按「baseline + events」重建派生统计。
   - 同步是 `INSERT OR IGNORE` + 唯一索引：重复同步不翻倍，整份保存 / 旧快照恢复也不删事件。
4. **文档同步**：`docs/ARCHITECTURE.md`、`docs/TESTING.md`、`docs/STORAGE.md`、
   `docs/reviews/2026-10-20-all.md`、`TODO.md` 已更新到当前状态。

## 下次优先做

1. **答题事件收尾（P1 可选）**
   - 统计 / 设置面板加「重建并核对」按钮，调用 `POST /api/store/learning/rebuild-derived`；
     目前 API 已可用，只差 UI 入口。
   - 如需要，再加一个「最近答题事件」只读列表，方便排查统计差异。
2. **无障碍收尾（审查 #9，低风险）**
   - `src/reader/panels/*` 里仍有纯文本按钮没有 `aria-label`；补齐后跑组件测试。
   - 键盘用户目前主要依赖全局快捷键，优先级低于数据类工作。
3. **真机验证（用户自己做）**
   - 听写 diff、理解题判分、仿写两轮闭环、语言点显示、写作历史。
   - 真实 TTS 发音 / 逐词高亮（离线音色无逐词时间戳时工具栏会提示「无逐词高亮」）。
4. **存量上帝文件（已清空）**
   - `state/session.ts` 1185 → 732、`ui/App.tsx` 1191 → 624、`reader/ReaderApp.tsx` 1036 → 781、
     `state/session.test.ts` 1057 → 拆成 4 个按主题的测试文件（共用 `sessionDoubles`）。
   - `tool/check_god_file.mjs` 的 `BASELINE` 现在是空的：新文件超 800 行一律拆，别再登记。
   - 第二批（2026-10-20）把三个「AI / 考试」hook 也拆了：`useAiPack` 587 → **505**
     （HTTP 与轮询搬去 `adapters/aiRun`）、`useQuizSession` 535 → **437**
     （设置搬去 `hooks/useQuizSettings`、候选池与出题集搬去 `core/quizPool`）、
     `useApplyTaskResult` 508 → **410**（表格型任务规则搬去 `core/aiApply`）。
   - 大文件清零了，剩下的都是 500 行上下的正常规模；想再动先看 `npm run gates` 里的「存量豁免」。
5. **记录分页（P2，暂不做，触发条件在 `TODO.md` 第 4 条）**
   - 渲染层没有全量列表（统计页只取最近 8 条、日志按天、错题本只算计数），所以 200 条也不卡。
   - 要做的前提是「数据层不再截断」：`core/mergeBackup` 现在 练习 500 / 错题 300 / 写作 200 /
     复述 200 / 会话 500，恢复备份时更早的记录本来就没了，先分页也翻不出东西。
   - 到了再做：服务端 `limit/offset` + 按 `at` 倒序的游标分页，别在全量数组上 `slice`。
6. **阅读页滚动进度与速读游标（2026-10-20）**
   - 滚动位置按文章存在 `reader:scroll:<文章标识>`（`core/scrollProgress` + `state/scrollPrefs` +
     `hooks/useReadingScroll`），存比例不存像素；会话内走内存缓存，重开才读 localStorage。
   - 速读游标键 = 文章标识 + 正文签名（`core/speedRead.speedCursorKey`）：同标识的不同文章不再串进度；
     停在/读完最后一句再退出会清零，读到中间退出仍保留。

## 换电脑怎么把数据带走

`data/`、`public/articles.json`、`public/shadowing-state.json` 都被 gitignore，**不会随 git 过去**。

- **最稳（整库）**：先停服务，把整个 `data/`（至少 `data/xueba.db`）拷到新机器同路径。
  首次打开会自动迁移到 schema v7 并生成当天备份。
- **只带学习记录 / 文章 / 词库**：应用里「导出全部（备份）」下载 JSON，新机器「导入备份」。
  文章、词库、学习记录（含答题事件）都会恢复。
- **只带 SQLite 单文件**：浏览器打开 `http://localhost:5173/api/store/db` 下载一致性快照。
- **代码**：`git clone` 后 `npm install`；开发用 `npm run dev`（精读页 `/reader.html`），
  生产用 `npm run build && npm run serve`。

不要同时保留旧机器的服务在跑同一个 `data/`（本项目不做多标签 / 多进程冲突处理）。

## 实时检查

```bash
curl http://127.0.0.1:5173/api/store/health
curl http://127.0.0.1:5173/api/store/learning
curl http://127.0.0.1:5173/api/store/learning/snapshots
curl http://127.0.0.1:5173/api/store/articles/<id>/prev
```

## 别再踩的约束

- 学习记录写库只有 `src/reader/hooks/useLearningSync.ts` 一个入口；不要新增第二个写 `LearningData` 的 effect。
- 每次学习记录写入前必须先快照；恢复前也快照；答题事件是 append-only，恢复旧快照时保留当前事件。
- 词库自动补全只走 `core/libraryAutoFill.ts`，React 里只有一个 effect 调它，依赖不放 `library`。
- 日期键只认 `core/activity.ts` 的 `dayKeyLocal` / `calendarDayKey`；事件里已落 `day`，服务端不另算日期。
- 不要再引入 espeak；TTS 链是 Edge → Piper → 浏览器 `speechSynthesis`。
- 新 schema 迁移前自动整库备份；`sqliteStore.js` 698 行、`sqliteLearning.js` 626 行，
  接近 800 行门禁，新增存储逻辑优先拆 `server/sqlite*.js`。
- 提交前跑 `npm run gates`；上帝文件基线只准往下调。

## 最近提交

```text
6a13c8d fix: 答题事件同步保持 append-only（去重且不删除）
c454849 feat: 答题事件 append-only 落库（schema v7）并可重建聚合
ed4aa4e refactor: 词库逻辑拆成 vocab 五个子模块，facade 只做出口
9f7c821 refactor: 背单词拆出设置/计时/卡内编辑与三个子组件
4fc4299 refactor: 速读会话状态机抽到 useSpeedReadSession
aab60a7 refactor: 速读选词/本页清单抽到 useSpeedReadWords
3b07900 refactor: SidePick 拆成待选/词典工具/AI 工作包子面板
8496121 test: 补 browserAudio 播放/录音回放接线测试
ec65223 refactor: useSpeaking 拆成播放/预热两层，facade 只做接线
```
