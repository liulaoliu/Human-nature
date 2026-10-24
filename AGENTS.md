# AGENTS.md — 项目开发约定（给 AI agent）

本项目自动加载此文件。**开工前读它 + `docs/ARCHITECTURE.md` + `docs/TESTING.md`**。

## 项目简介

「学吧老哥」——英语精读/背单词 Web 应用（React + TS + Vite；IndexedDB 存词库与文章）。
分层、依赖方向、新代码放哪里：见 **`docs/ARCHITECTURE.md`**（那份是可执行的约定）。
测试分层、门禁、踩坑清单：见 **`docs/TESTING.md`**。

## 运行环境：WorkBuddy Agent（本项目就是这么做开发的，不是普通终端）

本项目**由 WorkBuddy 里的 AI agent 开发**：模型靠工具调用读写文件、跑命令、跑测试。
**换环境（手敲终端 / CI / 别的 AI 客户端）时不要照搬下面这几条**：

- **工具优先于 shell**：读用 Read、改用 Edit/Write、找用 Glob/Grep；只有跑命令才动 Bash / PowerShell
  （Windows 上 Bash 是 Git Bash，路径用 `/`；PowerShell 是 5.1，别写 `&&`、`??`、三元）。
- **命令有硬超时**：前台默认 2 分钟、上限 10 分钟，超时**自动转后台**（不杀进程）。
  构建 / 全量测试 / 批量 AI 一律用后台任务启动，收到完成通知再汇报；命令里不写 `sleep` 轮询。
- **沙箱限制**（跟普通终端最大的差别）：
  - `wmic` 在程序黑名单里，调它直接 "PROGRAM BLOCKED BY SECURITY POLICY"——
    查进程 / 内存用 PowerShell 的 `Get-CimInstance Win32_Process`；
  - 删文件走 node-safe-delete 垫片：**单次批量删超过 50 个会被拒**（`Permission denied`），
    别 `rm -rf` 整棵树，按 ≤40 个一批、每批新起进程。
- **dev server 会偶发「模块 0 字节」，页面直接白屏**（2026-10-23 踩过）：
  浏览器报 `does not provide an export named 'xxx'`，但那个文件本身完好（tsc 过、esbuild 能转）。
  真实原因是 **vite 模块图缓存了一份空的 transform 结果**——文件被写到一半（截断态）时
  watcher 就触发了，vite 当场把空内容转掉并缓存；之后文件写完了也不会自动重转。
  `vite.config.ts` 里的 `server.watch.awaitWriteFinish` 就是防这个的，**别删**。
  万一还遇到：`npm run check:dev` 一条命令扫出是哪个模块（270 个模块约 3 秒），
  按提示 `touch` 那个文件或重启 dev server。
- **工具输出会被折叠**：用户看不到命令日志。**结论、报错原文、改了哪些文件、跑了几项测试，
  必须写进最终回复**，不能只丢一句「已完成」。
- **机器只有 16GB 物理内存**：并发别开满。全量测试固定
  `--pool=forks --maxWorkers=4 --minWorkers=1`（串行的 `--no-file-parallelism` 要 10 分钟，并行 2 分半）；
  tsc 内存吃紧时加 `--max-old-space-size=2048`。
  ⚠️ Windows 的「提交上限」= 物理内存 + 页面文件（本机约 60GB），**那不是内存**；
  报内存只说物理值（`Win32_OperatingSystem` 的 TotalVisibleMemorySize / FreePhysicalMemory）。
- **上下文会被压缩**：跨轮次还要用的决定（约定、结论、踩坑）写进 `docs/` 或
  `.workbuddy/memory/YYYY-MM-DD.md`，别指望下一轮还记得。

## 工作流（硬规则）

- **说做就做，不反问**：用户指出问题就改代码/跑命令，不要先问「要我改吗」再等。
- **执行纪律**：
  - 不写 `for … sleep` 盲等、不静默空转；查状态用一条短命令（`git status` / `tail` 日志 / 进程列表），几秒内出结果。
  - 构建、全量测试、批量 AI 等长命令放后台跑，跑完再汇报；**已经验证过且未受影响的，不重复跑**。
- **一个主题一次 commit**：一次改动含多个独立主题时，每完成一个主题立刻单独 commit
  （代码 + 连带测试/文档同批进该 commit），不攒到最后拆。message 用
  `feat:` / `fix:` / `refactor:` / `chore:` / `docs:` + 中文简述。
- **TDD × 分层**（`docs/TESTING.md` §1 判定矩阵）：
  1. 先想「这块判断能不能抽成纯函数」——能就抽到 `src/core/` 先写测试，再写实现；
  2. 按矩阵补齐该层测试；
  3. 收尾逐条勾 `docs/TESTING.md` §2「需求完成门禁」。
- **收尾门禁**（提交前必跑，别把不绿的留给我）：
  ```bash
  npm run gates    # tsc -b + 全部测试 + 上帝文件门禁 + 架构门禁
  ```
  - 上帝文件门禁：**新文件超 800 行直接失败**；存量超限登记在
    `tool/check_god_file.mjs` 的 `BASELINE`，**只准变小**（拆分后同步下调）。
  - 架构门禁：`tool/check_architecture.mjs` 的 R1–R8（依赖方向 / SSOT / 日期键 / 模块必须有测试 / `<p>` 里不许放块级标签）。
    真留着的存量违规要在 `EXCEPTIONS` 里**写明理由**（每次运行都会打印出来当债务）。
- **文档同步**（同一次提交里改）：结构/分层/新目录 → `docs/ARCHITECTURE.md`；
  新增踩坑 → `docs/TESTING.md` §3 补一条（编号 +1）；依赖原生/浏览器能力的用例 → §4 人工用例。
- **界面吸顶 / 吸底**（工具条不跟着滚走）**按需用，不是全局默认**：一屏放得下的弹窗、侧栏窄条、
  窄屏都不要硬加。判断标准和写法见 `docs/ARCHITECTURE.md` §三·六：
  先认滚动容器 → 负 margin 配等量 padding → 不透明底色 + z-index → 吸底抹掉 `.bar` 的
  `margin-bottom`；要一起吸的兄弟包一层，别各写一个 sticky；别用 `fixed` 假装吸底。
- **不重复跑已验证的东西**：跑过的门禁没受影响就别重跑；长命令放后台跑完再汇报。

## 两条最容易踩的硬约定（详见 ARCHITECTURE §三）

1. **同一份状态只允许一个写入方**：词库的自动补全统一走 `core/libraryAutoFill.ts`（纯函数、幂等）；
   React 里**只允许一个 effect** 调它，且依赖里不放 `library`（要读就读 ref）。
   加新的「自动补全」→ 往 `autoFillLibrary` 加一格，**别写第二个读写词库的 effect**。
2. **谁是事实来源谁负责算**：词条类型 → `core/entryKind.ts`；打印口径 → `core/printPlan.ts`；
   日期键 → `core/activity.ts`；语言点键/签名 → `core/langPoints.ts`。
   视图里不许出现这些规则的第二份实现（门禁会拦）。

## 单入口 SPA 与整页路由（硬规则，详见 `docs/ARCHITECTURE.md` §三·八）

- **不得新增 HTML 入口**。全站只有 `index.html` + `src/main.tsx` + 一棵 React 树；
  新页面是路由，不是新的 `createRoot`。`/` 是跟读，`/reader/**` 是精读。
- **凡是占满正文、遮住当前页的界面都必须有 URL**（全屏会话 / 工具页 / 向导 / 编辑器）。
  加之前先问一句：**刷新或把地址发给别人，能不能回到这一页？** 不能就先加路由。
- 接线只放两个地方：布尔面板 → `src/reader/route.ts` 的 `useRoutedPanels`；
  整页会话 → `hooks/useRoutedFlows.ts` + `hooks/useReaderFlowRouting.ts`。
  **别在按钮的 onClick 里各自 `navigate`**，否则历史层数和状态很快对不上。
- 历史语义固定：**点按钮打开 → push；页面内关闭 → replace；浏览器返回 → 关闭会话、不再 push**。
  深链接要等词库/文章就绪后再判断失败，失败回落文章页，不允许停在空界面。
- URL 是事实来源，但不要每次渲染都写：状态 → URL 只在用户动作后写；同步 effect 必须幂等，
  依赖放字符串/布尔，别放每次新建的对象。补文章 URL 时要保留已开的面板。
- 路由纯函数（`parse` / 路径构造）、历史 hook、路由树都要有测试；
  组件里用到 `Link` / `useNavigate` 的，测试必须包 `MemoryRouter`。
- 阅读页 CSS 必须 `?inline` 注入并在卸载时删除（或完全 scoped）；
  **不许普通懒加载把 `<link>` 永久留在 head**，否则回到 `/` 后全局样式仍被覆盖。
- 新路径、旧地址兼容、dev 回落、生产回落是**一处改动四个落点**，按 ARCHITECTURE 的清单一起改；
  带扩展名的缺失资源必须继续 404，不能回落成 HTML。

## Code Review（报词即执行，流程见 `docs/CODE-REVIEW.md`）

- **`r`**：审当前未提交变更（`git diff` + `git status`），按 A–G 七维度出问题表；默认只报不改。
- **`r -list`**：只做落点映射，建议跑哪几维。
- **`r -all`**：全库审查，产出 `docs/reviews/YYYY-MM-DD-*.md`；默认只报不改。
- 后缀 **`修`** 才动代码：按 P0→P1 修，每主题单独 commit，修完跑 `npm run gates`。
- 七维度：**A 架构 / B 数据 / C 测试 / D 口径 / E 工程 / F UI / G 安全**；
  每条结论必须带 `文件:行号`，子代理的发现要复核后再写进报告。
- 审查报告是债务清单：修完勾掉，没修的保留可见，不删档。

## 外部输入必须运行时校验

- 备份 JSON、AI 粘回结果、`/api/store/*` 响应、localStorage 旧数据——**一律先过 `core/` 的解析/守卫函数**，
  禁止 `JSON.parse(...) as T` 后直接进业务。
- 守卫函数返回「好数据 + 丢弃条数/原因」，界面要能提示；坏数据不许静默变成空库。
- 新增数据结构：`core/` 里同时写 `parse/normalize` 与测试；服务端表结构变化同步 `docs/STORAGE.md`。

## 处理 AI 工作包：`new/ai-jobs-*.json`

当用户让你处理 `new/` 下的 `ai-jobs-*.json`（或说「生成结果 / 跑一下工作包 / 处理这批 AI 任务」）时：

1. **直接开干，不要反问**：读取该文件，按它内嵌的 `instructions` 字段逐个 job 作答。
2. 结果写到**同名、扩展名换成 `.results.json`** 的文件：
   `new/ai-jobs-xxx.json` → `new/ai-jobs-xxx.results.json`。
3. `id` 原样照抄；`raw` 是字符串（内容本身是 JSON / 表格就转义进去）。
4. 一次答不完就**少写几条**（绝不用省略号），之后可补。
5. 不要复述任务、不要解释、不要输出无关总结。

只有当**确实缺少必要信息**（例如找不到文件）时才提问。

## 自动跑批的两条路

- 有 API key：`npm run ai:pack`（`tools/ai-pack.mjs`，直连模型接口）。
- 走本机 agent：`npm run ai:agent`（`tools/ai-agent.mjs`，非交互起 `ai-batch` agent），
  或双击根目录 `跑AI结果.cmd`。二者都产出可被应用「导入 AI 结果」的文件。
