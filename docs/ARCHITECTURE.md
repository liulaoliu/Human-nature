# 架构说明（分层 / 依赖方向 / 新代码放哪里）

> 这份文档 + `docs/TESTING.md` + `tool/check_*.mjs` 是**可执行的约定**：
> 光写「我们分层」没用，`npm run gates` 会把违规拦下来。
> 结构变化时**同一次提交**里更新本文（见 AGENTS.md「收尾门禁」）。

## 一、分层与依赖方向

```
src/types/       纯数据模型（Document / VocabItem / SentenceLanguage…），零逻辑
src/core/        纯领域逻辑：不碰 React、不碰 DOM、不碰存储 —— 全部可单测
src/adapters/    实现 core 端口（ports）的 IO 层：SQLite(HTTP) / IndexedDB / fetch / TTS / 备份
src/reader/      React 视图层
  hooks/         有状态编排（会话状态机、与 IO 的接线），不含排版
  panels/        展示组件（尽量薄：收 props、渲染）
  ReaderApp.tsx  组装：状态总线 + 把 hooks/panels 接起来
src/ui/          跟读练习（旧模块，独立于精读词库）
```

**依赖只能单向往里收**（由 `tool/check_architecture.mjs` 的 R1/R2 保证）：

```
types ← core ← adapters ← reader
                 ↑
        core ← reader/hooks（注入端口，不直接开库）
```

- `core` **不许** import `react / reader / adapters / ui / state`，也不许碰 `localStorage / indexedDB / document / window`。
  → 想读存储？在 `core/ports.ts` 定义端口，由 `adapters` 实现、由 `reader` 注入。
- `adapters` 不许认识界面。
- 展示层（`reader/panels`、`ui`）不许直接读写 `localStorage / indexedDB`（R3）；面板本地状态走 `useLocalStorageState`。
- hooks 不许直接开 IndexedDB（R4）；仓储从 `ReaderApp` 注入。

## 二、新代码放哪里（选层清单）

| 你要加的东西 | 放哪 | 注意 |
|---|---|---|
| 计算 / 规则 / 解析 / 纯函数 | `src/core/<领域>.ts` | 必须有同名 `.test.ts`（R7）；不许碰 IO |
| 词条「类型」相关的判断与标签 | `src/core/entryKind.ts` | **SSOT**，视图不许再抄一份字面量（R5） |
| 语言点（词组/习语/用法）的收集与键规则 | `src/core/langPoints.ts` | 与 `vocab.ts`（单词规则）分开 |
| 打印/导出的「选哪些条目」 | `src/core/printPlan.ts` | 面板只收集选择 + 渲染 |
| 日期键（今天/哪天） | `src/core/activity.ts` | `dayKeyLocal`（逻辑日，04:00 结算）/ `calendarDayKey`（日历日）；**不许自己拼**（R6） |
| 需要读写存储/网络 | `src/core/ports.ts` 定义端口 → `src/adapters/*` 实现 | 内存兜底实现放同文件（隐私模式） |
| 有状态的交互流程 | `src/reader/hooks/use*.ts` | 一个 hook 一件事；**同一份状态只允许一个写入方** |
| 全局键盘 | `src/reader/useHotkeys.ts` + `hotkeys.ts` | 只允许一个全局分发器，按优先级启用当前模式；禁止再直接 `window.addEventListener('keydown')` |
| 面板 / 列表 / 对话框 | `src/reader/panels/*.tsx` | 不准塞领域判断；判断回 core |
| 词库自动补全（例句/收藏…） | 加进 `src/core/libraryAutoFill.ts` | **不许再写第二个 effect 去读写词库**（见下） |

## 三、两条硬约定（都是踩过坑换来的）

### 1) 词库的「自动补全」只有一个写入口

`core/libraryAutoFill.ts` 是纯函数：输入词库 + 素材 → 输出下一个词库。
`ReaderApp` 里只有一个 effect 调它、只写一次。

**为什么**（踩坑 #1）：以前「离线例句补全」和「语言点收藏」是两个 effect，各自
`读 library → 算 → 写 library`。两个 effect 在同一个渲染里从**同一份快照**出发，
后写的覆盖先写的；再叠加「基于旧快照重算」，就变成你加我删、词库数量在
7694/7696 之间来回跳。现在：**写入方唯一 + 纯计划 + 幂等**，这类 bug 从结构上消失。
新增自动补全时，往 `autoFillLibrary` 里加一格，不要在 React 里再写一个 effect。

### 2) 谁是「事实来源」谁负责算

- 词条类型：`core/entryKind.ts`（`KIND_LABEL` / `KIND_ORDER`）。
- 打印范围/内容/分组：`core/printPlan.ts`（同时是文案来源 `PRINT_*_LABEL`）。
- 日期：`core/activity.ts`。
- 语言点的键与签名：`core/langPoints.ts`。

视图里**不许**再出现这些规则的第二份实现（门禁 R5/R6 会拦）。

## 三·五、数据安全（事故之后立的规矩）

用户的词库是**唯一资产**，任何重构都不许让它的丢法变多。四条铁律：

1. **单写入口**：词库只由 `hooks/useVocabLibrary.persist` 写；自动补全只由
   `core/libraryAutoFill` 这一个 effect 写。新需求加「自动补全」→ 往计划函数里加一格。
2. **读成功才写**：加载态三态（pending/ok/failed）；failed 时 persist 直接拒绝并提示恢复。
3. **覆盖前留快照**：仓储每次 save 追加一版历史（最近 8 版 + 历史最大的一版永久保留），
   提供 `listSnapshots / loadSnapshot`；侧栏有「恢复上一版词库」（误清/误导入一键退回）。
4. **同一份事实存多处**：词条 ← SQLite(`data/xueba.db`) / IndexedDB 镜像 / 文章 `Sentence.vocab` /
   待选清单(localStorage) / 错题本 / 「导出全部」JSON；语言点 ← 文章 `SentenceLanguage` / 词库里的语言点条目。
   → 坏了就靠「导入备份」＋「恢复上一版词库」；写入侧永远走上面三条。

> 新增「用户资产」时先问：**它有第二份吗？** 没有就先补上第二份，再谈别的。

### 存储：SQLite 主存，IndexedDB 只做兜底

词库 / 已保存文章默认走本地服务的 SQLite（`data/xueba.db`，Node 自带 `node:sqlite`）；
服务没起、静态部署、Node < 22.5 时自动回退 IndexedDB。详细取舍、schema、迁移和导出见
[`docs/STORAGE.md`](STORAGE.md)。改数据层时：

- 先改 `src/core/ports.ts` 的端口，再改 `src/adapters/*` 的 HybridRepo，**不要**在视图里直接 `fetch('/api/store')`；
- 服务端只暴露固定路由（`server/storeApi.js`），不加任意 SQL 接口；
- SQLite 内部分两层：`vocab` / `articles` 的 `payload` JSON 是事实来源，
  `words` / `article_sentences` / `lang_points` 等是**同一事务里重建的派生表**；
  不要绕过 `saveVocab` / `saveArticle` 直接写派生表；
- schema 变更走 `PRAGMA user_version` 迁移；新表/新列要留旧库升级测试；
- 用户资产写入必须同时考虑 IndexedDB 兜底和「导出全部」；
- 上帝文件门禁扫描 `src/`、`tools/`、`server/`：新文件 >800 行直接失败，拆出去再写。

## 四、有意为之的例外（别当违规修）

- **单词和语言点共用一份词库存储**（`VocabItem.kind` 区分）。
  取舍：打印/导出的「按篇 / 按日期 / 未打印 / 分组」整套选项可以零成本复用；
  代价是显示层要按类型分开渲染（侧栏「生词 / 语言点」两个页签，`LangPointList`）。
- **`ReaderApp.tsx` 偏大（3021 行）**：已登记在 `tool/check_god_file.mjs` 的基线里，
  **只准变小**。它现在是「状态总线 + 接线」，领域逻辑要一律往 core/hooks 外面搬。
- **`src/ui/*`（跟读练习）直接读写 localStorage**：独立老模块，暂不改造，已登记豁免。
- **`calibrationRepo` / `scriptEditRepo` 仍走 localStorage**：一篇几个数字/几十 KB、接口是同步的；
  不是为了省事才不迁 SQLite——浏览器里上 SQLite 要 WASM 运行时，为这点数据不划算。
  真要迁，先改端口为异步，再走服务端 SQLite。
- **离线词典/例句加载器已搬到 `adapters/`**：`adapters/dictionary.ts`、`adapters/tatoeba.ts`；
  `core/dictionary.ts` 只保留纯断词判断（不碰 fetch）。

## 五、命令

```bash
npm run gates        # 收尾门禁：tsc + 全部测试 + 上帝文件 + 架构
npm run check:arch   # 只跑架构门禁（含存量豁免清单）
npm run check:size   # 只跑上帝文件门禁（含基线）
npm test             # vitest run
npm run test:watch   # 开发循环
```

门禁细节与「测试怎么写」见 `docs/TESTING.md`；工作流与收尾清单见 `AGENTS.md`。
