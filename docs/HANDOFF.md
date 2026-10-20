# 交接记录（2026-10-19）

给明天/换电脑继续用。**多标签页冲突仍然明确不做**，用户只开一个标签页。

## 当前状态

- 分支：`main`
- 本轮最后提交：`d78ada5 fix: 服务长开跨天自动补每日备份`
- 工作树：干净
- schema：`PRAGMA user_version = 7`
- 门禁：`940 passed / 5 skipped`；`npm run gates`、`npm run build` 都通过
- 实时库：`data/xueba.db`（本地，不进 git）

## 这轮补了什么

1. **文章上一版**：覆盖/删除前写 `article_prev`；`GET /api/store/articles/:id/prev`、
   `POST /api/store/articles/:id/restore-prev`。恢复会把当前版再写进 prev，可反悔。
2. **备份校验**：`VACUUM INTO` 后立刻只读 `quick_check`；坏备份删除重做；当天已有备份损坏也会重建。
3. **学习记录失败重试**：`useLearningSync` 失败保留 dirty，按 5s 起、最长 60s 退避**整份重试**；
   服务恢复后不刷新页面也会补写 SQLite。
4. **JSON 备份补全**：导出/导入/合并现在包含复述、每天背过的词、略读标记、按篇/题型统计。
5. **长开自动备份**：服务每 30 分钟检查日期，跨午夜补当天 `xueba-daily-*.db`，不用重启。

## 明天在这台机器继续

```bash
cd /home/Gxkj-123/env/Human-nature-main
git pull origin main
npm install          # 一般不用，依赖没变
npm run gates        # 945 项左右，几秒
npm run dev          # 精读页 http://localhost:5173/reader.html
```

生产模式：`npm run build && npm run serve`。

实时检查：

```bash
curl http://127.0.0.1:5173/api/store/health
curl http://127.0.0.1:5173/api/store/learning/snapshots
curl http://127.0.0.1:5173/api/store/articles/<id>/prev
```

## 换电脑怎么把数据带走

`data/`、`public/articles.json`、`public/shadowing-state.json` 都被 gitignore，**不会随 git 过去**。

- **最稳（整库）**：先停服务，把整个 `data/`（至少 `data/xueba.db`）拷到新机器同路径。
  首次打开会自动迁移并生成当天备份。
- **只带学习记录/文章/词库**：应用里「导出全部（备份）」下载 JSON，新机器「导入备份」。
  文章和词库会恢复；学习记录现在也包含在 JSON 里。
- **只带 SQLite 单文件**：浏览器打开 `http://localhost:5173/api/store/db` 下载一致性快照。

不要同时保留旧机器的服务在跑同一个 `data/`（本项目本来就不做多标签/多进程冲突处理）。

## 下次优先做

1. **答题事件表（P1，架构债）✅ 已完成（2026-10-20）**
   - 已加 append-only `answer_events`（schema v7），`useQuizSession` / `useDictation` / `useListening`
     逐题记对错、题型、文章、时间、活动分类；`useLearningData.recordAnswer` 统一追加。
   - `activity` / `kindStats` 仍写聚合值兼容 UI；v7 迁移把历史聚合存进
     `learning_derived_baseline`，`POST /api/store/learning/rebuild-derived` 按「baseline + events」重建。
   - 纯函数口径在 `core/answerEvents.ts`（解析守卫 / 追加 / 从事件重建）。
   - 后续可选：统计面板增加「重建对账」入口；目前 API 已可用。
2. **记录分页（P2）**
   - 当前练习 500 条、错题 300 条、写作 200 条等都有上限；数据量还没到，先不做。
   - 真要做：服务端 `limit/offset`，UI 按需加载；不要为了分页改事实来源。
3. **可选的 UI**
   - 学习快照/文章上一版目前只有 API，没有恢复按钮；需求明确时再加面板。
   - 多标签页/版本合并/冲突解决：**不做**。

## 别再踩的约束

- 学习记录写库只有 `src/reader/hooks/useLearningSync.ts` 一个入口；不要新增第二个写 `LearningData` 的 effect。
- 每次学习记录写入前必须先快照；恢复前也快照。
- 词库自动补全只走 `core/libraryAutoFill.ts`，React 里只有一个 effect 调它，依赖不放 `library`。
- 日期键只认 `core/activity.ts` 的 `dayKeyLocal` / `calendarDayKey`。
- 不要再引入 espeak；TTS 链是 Edge → Piper → 浏览器 `speechSynthesis`。
- 新 schema 迁移前自动整库备份；`sqliteStore.js` 已 698 行、`sqliteLearning.js` 626 行，
  接近 800 行门禁，新增存储逻辑优先拆 `server/sqlite*.js`。
- 提交前跑 `npm run gates`；上帝文件基线只准往下调。

## 本轮提交

```text
d78ada5 fix: 服务长开跨天自动补每日备份
f15acab fix: JSON 备份补全复述/背词日/略读/题型统计
70f7071 fix: 学习记录写库失败后退避整份重试
e3d1214 fix: 备份写入后校验，损坏的当天备份自动重建
7f5e6c0 feat: 文章覆盖/删除前保留上一版并可恢复
1e9cb3d refactor: 拆分 SQLite 整库备份模块
```
