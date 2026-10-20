# 测试规范（分层 / TDD / 门禁 / 踩坑）

> 这份文档是**可执行规范**：门禁在 `npm run gates`，踩坑清单是「别再犯」的记录。
> 借鉴 patrol_helper 的做法：TDD 是**方法**，分层是**选层**，门禁是**验收**。
> 组件/钩子测试环境已就绪（jsdom + Testing Library，见 §5）；浏览器能力走 §4 人工用例。

## 一、测试分层与选层判定矩阵

| 功能性质 | 必须补的测试层 | 本仓库放哪 |
|---|---|---|
| 纯逻辑（计算 / 规则 / 解析 / 键规则） | **单测**（`src/core/*.test.ts`） | 已有 40+ 文件、800 项 |
| 数据层（IndexedDB / fetch / 备份） | 单测（内存兜底实现 / 假端口） | `adapters/` 的 Memory* 实现 |
| 有状态编排（effect / 会话状态机 / 写入策略） | **钩子测试 + 把判断抽成纯函数** | `hooks/useLibraryAutoFill.test.tsx`、`hooks/useReadDone.test.tsx`、`core/libraryAutoFill.ts` |
| 单个面板 / 列表 / 对话框 | 组件测试（环境已就绪，待补） | `reader/panels/*` |
| 浏览器能力（打印对话框 / TTS / 剪贴板 / IndexedDB 真库） | **人工用例**（§4） | 登记，不写自动化 |

**判定原则**：先问「这块判断能不能抽成纯函数」。能 → 抽出去写单测（最便宜、最稳）；
不能（纯排版/手势/浏览器 API）→ 组件测试或人工用例。**别用「跑起来点一下」当测试。**

## 二、需求完成门禁（Definition of Done，收尾逐条勾）

```
□ 先写/改测试，再写实现（TDD；至少：新规则一落地就有用例钉住）
□ 按 §1 矩阵补齐对应层；领域判断不在组件里
□ 新增 core 模块 → 同名 .test.ts（否则架构门禁 R7 失败）
□ npm run gates 全绿：tsc + 全部测试 + 上帝文件门禁 + 架构门禁
□ 结构/分层/新增目录变化 → docs/ARCHITECTURE.md 同步
□ 新增踩坑 → 本文档 §3 补一条（编号 +1）
□ 影响面跨模块 / 动了共享层（type、core 通用函数）→ 跑全量 npm test
□ 浏览器能力相关 → §4 登记人工用例（含通过标准）
```

## 三、踩坑清单（别再犯）

1. **两个 effect 各自「读库 → 写库」= 互相覆盖**。
   现象：词库条目数在 7694/7696 之间来回跳（导出面板数字跳动）。
   根因：同一次渲染里两个 effect 从同一份快照出发，后写的覆盖先写的；再叠加「基于旧快照重算」就成了死循环。
   规矩：**同一份状态只允许一个写入方**；自动补全统一走 `core/libraryAutoFill.ts`（纯函数、幂等），
   依赖里**不放被写的状态**（要读就读 ref）。
2. **日期键别自己拼**。以前「今天」有 4 种算法（`slice(0,10)` 的 UTC、本地 0 点、减 4 小时…），
   凌晨学习和目标/连续天数对不上。现在只有 `core/activity.ts` 的 `dayKeyLocal`
   （逻辑日，**04:00 结算**，本地时区）与 `calendarDayKey`（日历日）；门禁 R6 拦自己拼。
3. **跨领域字段别让两个领域共用键**。中文「用法笔记」曾经用笔记里那个英文单词当去重键，
   结果和真正的单词词条撞车，把单词误标成「用法」（不进背单词/考试）。
   规矩：不同形状的数据有不同的键规则（`core/langPoints.ts` 的 `langPointKeyAndKind`）。
4. **自动补全必须幂等且有「终结标记」**。否则同一件事会被反复做（无限写库、AI 任务反复排）。
   例：语言点按**每篇内容签名**记账（`reader:langCollected`）；例句按条数封顶；
   语法标记写空数组表示「查过、无可标」。
5. **老数据的兼容与修复要有判据**。修早先版本的误标时不能凭猜：
   `repairLanguageKinds` 用「有 kind 但没有 `langPointId`」判定是旧数据 —— 新代码写入的一定带标记。
6. **打印/导出的选项是「范围 × 内容 × 分组」的笛卡尔积**，任何一处自己实现都会漂。
   现在统一在 `core/printPlan.ts`，面板只是收集选择（门禁会拦面板里出现 `lastPrintedAt` 之类的领域判断）。

7. **「读失败 → 写空库」= 数据全灭**（真实事故，丢过一次 7694 词）。
   链路：词库从 IndexedDB 读失败 → 拿到空库 → 加载态被置成 true → 自动补全把「空库 + 语言点」写回去。
   规矩三条：**读成功才允许写**（`libraryLoad === 'ok'` 硬闸）；**覆盖前留快照**（保留最近 8 版 +
   历史最大的一版永不淘汰）；**同一份事实存多处**（词库 / 文章 `Sentence.vocab` / 待选清单 /
   错题本 / 导出 JSON，任何一处被毁都能重建）。
8. **「只存在于一处」的东西，出事就真没了**。能从别处救回的只有「别处还留着痕迹」的词
   （文章里的 `Sentence.vocab` / 待选清单 `reader:batch` / 错题本 / 以前导出的 JSON）；
   直接从正文点选、只写进词库的那部分救不回。
   所以新增任何「用户资产」时，先问：**它还有第二份吗？**

9. **CSS Grid 里给某一项定 `grid-row` 会把它抢到前面的列**，正文被挤走。
   现象：语言点列表的「改 / 删」跑到了左边，原文/翻译被推到右半边、来源句被截断。
   根因：自动放置算法**先**摆「行位置确定」的项（`.lp-act{grid-row:1/3}` 占了第 1 列），
   剩下正文（含 `grid-column:1/2` 的来源句）只能去第 2 列/下一行。
   规矩：左右两栏的列表用 `display:flex`（`.lp-body` 撑满 + `.lp-act` 贴右），别用「只给一侧定位」的 grid；
   组件测试断言 `.lp-body` / `.lp-act` 的从属与先后，防止再漂。
10. **TTS 兜底不能只押浏览器 `speechSynthesis`**。Linux Chromium 默认没装 `speech-dispatcher`，
    `getVoices()` 是空数组、`speak()` 静默失败；服务端 Edge 也可能因 IPv6 / 代理报 `ENETUNREACH`
    （Node 默认不走系统代理，`tools/tts-core.mjs` 显式读 `HTTPS_PROXY` / `HTTP_PROXY`）。
    规矩：**服务端本地引擎（Piper）先兜底，浏览器语音只作最后一道**；
    离线音色必须能在顶栏手动选；离线引擎没有逐词时间戳时**不要缓存空数组**，否则 Edge 恢复后也拿不回高亮。
11. **IndexedDB 不能是唯一资产库**。它按来源隔离、会被浏览器回收、多标签没有统一事务；
    数据层已改为 **SQLite 主存（`data/xueba.db`）+ IndexedDB 兜底/镜像**。
    规矩：新增用户资产先走 `core/ports.ts` 端口 → `adapters` 的 HybridRepo；schema 变更走
    `PRAGMA user_version` 迁移；服务端只加固定路由（`server/storeApi.js`），不加任意 SQL 接口。
    详细取舍见 `docs/STORAGE.md`。
12. **写库失败后只清 `pending` = 这一块永远不再重试**。
    现象：服务临时停掉时答的题，服务恢复后不刷新就一直没进 SQLite；只有下次改到同一 section 才碰巧补上。
    规矩：失败**保留 dirty**，按 5s 起、最长 60s 的退避**整份重试**（不能只重放 pending，
    否则更早失败、已经不在 pending 里的 section 会漏）；卸载时置 disposed，别让在途请求又排定时器。
13. **测试里别直接摸全局 `localStorage`**。Node 26 自带只读全局，jsdom 又因不透明来源跳过，
    `@vitest-environment jsdom` 也不保证拿得到 —— 直接 `localStorage.setItem` 会报
    `Cannot read properties of undefined`。规矩：组件/钩子测试统一
    `installFakeStorage()`（`src/reader/testStorage.ts`），`afterEach` 还原；详见 §5.2。
14. **读接口不要顺手写库**。`HybridArticleRepo.list()/get()` 以前会把本地较新的文章 `PUT` 回服务端，
    读一次列表就 N+1 次网络写，失败还会把 repo 切成 local。规矩：读只读 + 合并；迁移放显式
    `reconcile()`，由宿主在启动时调一次；新增仓储先问「这个方法有没有副作用」。
15. **全局键盘只能有一个分发器**。各模式各挂 `window.addEventListener('keydown')` 时，靠内部
    「当前是不是我」判断，新增模式很容易一次按键触发两个动作。规矩：一律用
    `src/reader/useHotkeys.ts` + `hotkeys.ts`，按优先级只让最高层响应；同优先级才并行
    （如 ReaderApp 的 Ctrl 跟踪 + 正文快捷键）。
16. **空 `catch` 要分类**。用户资产（词库 / 学习记录 / 备份 / 待选）写失败必须
    `reportStorageFailure()`（log + 广播 `reader:storage-error`）或 `flash` 可见提示；
    可选能力（TTS、剪贴板、持久存储申请）可以保留空 catch，但要写明「失败可降级」的理由。

## 四、人工用例（自动化覆盖不到的，登记在此）

| 场景 | 步骤 | 通过标准 |
|---|---|---|
| A4 打印 | 侧栏「🖨 打印 / 导出…」→ 选内容/范围/分组 → A4 打印 | 新窗口版式正确（3 栏、词组带类型小标）、打印后条目变「已打印」 |
| 离线词库/例句 | 装好 `public/ecdict.tsv` / `tatoeba-en.tsv` 后刷新 | 生词卡自动有音标/释义/离线例句；控制台无报错 |
| 速读悬浮释义 | 速读里悬浮已收录的词 | 显示释义；未开「选词模式」时点词有提示（不是静默） |
| 语言点自动收藏 | 跑一次「语言点」AI 任务并粘回 → 刷新 | 侧栏「语言点」页签出现词组/习语/用法；删掉一条后刷新**不会**自己回来 |
| IndexedDB 持久化 | 加几个生词 → 刷新 → 换文章再回来 | 词库在；来源文章/句子正确 |
| 离线 TTS（Piper） | 跑 `./tools/install-piper.sh` 后重启服务 → 刷新 → 音色选「离线 · 本地语音」里的 Piper → 读本句 | 有声、不联网、明显比系统机器人音自然；无逐词高亮可接受；切回 Edge 后恢复 |
| Piper 失败 → 浏览器语音 | 临时把模型目录改空（`PIPER_VOICES_DIR=/tmp/empty` 重启）→ 手动选 Piper 音色 → 读本句 | 退回浏览器语音，不报 502 |
| TTS 自动兜底 | 让 Edge 不可用（断网 / 代理坏）→ 读本句 | 仍出声（先 Piper，再浏览器语音）；约 20 秒后自动回头重试 Edge |
| Chromium 浏览器语音兜底 | 装 `speech-dispatcher` 后重启 Chromium → 停服务 → 读本句 | 浏览器语音有声；控制台无 `speechSynthesis` 报错 |
| SQLite 主存 / 迁移 | 先在有旧 IndexedDB 数据的浏览器打开新版 → 刷新 → 查 `data/xueba.db` | 词库/文章迁到 SQLite；刷新后仍是同一份；停服务后页面仍能读 IndexedDB 兜底 |
| SQLite 导出 | 浏览器打开 `http://localhost:5173/api/store/db` 或 `/api/store/export?download=1` | 下载 `.db` / JSON；`sqlite3 data/xueba.db '.tables'` 能看到 `vocab`、`articles`、`words`、`article_sentences`、`lang_points`、`learning_snapshots` |
| 完整 JSON 备份 | 侧栏「导出全部（备份）」→ 清空 localStorage 或换浏览器 → 「导入备份」 | 复述、每天背过的词、略读标记、按篇/题型统计也恢复；同一份备份「合并导入」两次：第二次按文件指纹直接跳过并提示（不同备份仍按天累加学习时长/活动） |
| 学习记录快照 / 恢复 | 先做几次答题/背词 → `GET /api/store/learning/snapshots` 取一个 id → 执行若干改动 → `POST /api/store/learning/snapshots/<id>/restore` | 恢复后练习/错题/背词记录回到快照时点；恢复前当前状态也进了快照，列表多一条 |
| 写入失败自动补写 | 停掉后端服务 → 答几题（localStorage 有记录）→ 重新启动服务，**不刷新页面** → 等约 5–10 秒 → 查 SQLite | `data/xueba.db` 的 `practice_records` 等表补上新记录；`localStorage` 的 `reader:learningDirty` 被清掉 |
| 文章上一版 / 恢复 | 改一篇文章正文并保存 → 再改一次 → `GET /api/store/articles/<id>/prev` → `POST /api/store/articles/<id>/restore-prev` | 恢复后回到上一版；再调一次 restore 能切回恢复前那一版（prev 会保留当前版） |
| schema 迁移备份 | 用旧版本创建的 `data/xueba.db` 启动新版 | 启动日志有「迁移前备份」；`data/backups/xueba-v<旧版本>-*.db` 存在，保留最近 5 份；同次启动还会生成当天 `xueba-daily-*.db`（保留 7 天） |
| 备份损坏自愈 | 停服务 → 把当天 `data/backups/xueba-daily-*.db` 覆盖成任意文本 → 重启 | 日志出现「当天备份校验失败，重新生成」；备份文件恢复为可 `quick_check` 的正常库 |
| 速读 · 语言点输入框 | 非护眼深色主题 → 速读 → `＋ 语言点` → 在「结构 / 语法」里输入 | 输入文字与光标清晰可读（深底浅字）；切护眼主题后为白底深字 |

## 五、已经就绪的层 / 还差什么

**已就绪**：纯逻辑单测（`src/core/*.test.ts`）+ **钩子接线测试**（`src/reader/hooks/*.test.tsx`）
+ **集成测试**（`src/reader/ReaderApp.integration.test.tsx`：假仓储挂载，自动补全只写一次、语言点粘回不重不漏）
+ **组件测试**（`src/reader/panels/*.test.tsx`：`ExportPanel`（内容×范围×动作交给打印的条目与标题）、
`SideVocab`（生词/语言点两个页签、打印只交当前页签）、`LangPointList`（分组/来源句/两步删除）；
`ReaderShell`/`ReaderArticle` 钉三个 slot 的顺序与编辑态；`SessionHost`（六类会话面板按状态互斥渲染）；
`ReaderSidebarHost`（假 API → 断言五组面板 props 的映射、会话按钮顺序）；
`ReaderToolbarHost`（整包映射 / 朗读选中句 / 分组设置 / 不可见时不渲染）；
`StudyDrill`（强制锤炼选词义键盘）、`SpeedReadSentence`（阅读/揭示/拷打三态）、`SpeedReadBasket`（清单增删与结算））。
**会话 hook 已有**：`useQuizSession`（出题/判分/错题/卸载定时器）、`useDictation`（整句/判分/错题/卸载）、
`useSpeaking`（服务端起播/回退/停声）、`useAiPack`（status 探测/空待办/导出/坏结果）、
`useExport`（导入覆盖/坏文件/合并幂等/打印拦截）、`useBatchQueue`（坏数据守卫/按 lemma 去重/按文章持久化）、
`usePregenerate`（缓存命中/只补缺/取消/换音色失效）、`useArticleBootstrap`（迁移失败不挡列表/目录失败标记）、
`useReaderDerived`（派生统计簇：会话/背词/到期/候选/待选过滤，固定 `now` 钉住输出）、
`useVocabEdits`（批量直入 / 手动加词 / 词组入库 / 移出：坏输入、去重、连续写不覆盖）、
`useAiTasks`（语言点 / 漏词重问的提示词复制：无文章、剪贴板失败、问过范围）、
`usePasteApply`（单任务应用 / 工作包统一入口：空输入、成功清空、失败保留、语言点自动识别）。

组件/钩子测试的三个坑（都踩过了，照着做）：
1. 默认环境是 `node`（快）；要测 React 就在**文件第一行**写 `// @vitest-environment jsdom`。
2. jsdom 的 `localStorage` **取不到**（不透明来源会被 vitest 跳过），Node 26 又自带一个**只读**的全局
   `localStorage`，直接赋值会静默失败 —— 一律用 `src/reader/testStorage.ts` 的 `installFakeStorage()`
   （defineProperty 覆盖 + 测完还原）。
3. 钩子/面板依赖 IO 时**注入假实现**（`persist` / `libraryRef` / `onPrint` 这类回调），别真的开 IndexedDB、
   别真的调 TTS/打印。

**还差**：
- **跨模块集成**：挂载 `ReaderApp` + 假仓储，断言「自动补全只写一次 + 导入 AI 结果不重不漏」。
- **覆盖不到的（人工用例见 §4）**：A4 打印版式、TTS 发音、真实 IndexedDB 库、离线词典/例句文件。
- **覆盖率数字**：接 `@vitest/coverage-v8` 再看（先求「该测的层有测试」，再求百分比）。

## 六、执行

```bash
npm test                      # 全部（约 800 项，几秒）
npx vitest run src/core/langPoints.test.ts   # 定向：开发循环用这个
npm run gates                 # 收尾门禁（提交前必跑）
```
