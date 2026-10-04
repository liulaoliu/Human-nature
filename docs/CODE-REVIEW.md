# 代码评审 & 架构意见

> 以「老架构师」的视角，对当前代码做一次全面 review：好在哪、问题在哪、怎么改（保留全部功能，允许重写）。
> 规模参考（2026-10）：`ReaderApp.tsx` **5840 行**、53 个 `useState`、35 个 `useEffect`、112 个 `useCallback`；`src` 核心 ~15.4k 行；**537 个测试**通过。
> 性能踩坑单独记在 [`PERF-NOTES.md`](./PERF-NOTES.md)。

---

## 一、总体判断

这是一个**底子很好、但被"长"出来的 UI 拖住**的项目。

- **底层（core / adapters / ports / types）是干净的**：纯函数 + 依赖倒置 + 测试，符合"整洁架构"。
- **上层（`ReaderApp` 巨型组件）已经失控**：一个文件同时管阅读、选词、生词本、考试、背单词、快刷、听写、听力、仿写、统计、错题本、AI 粘回、文章管理……**任何新功能都往同一个组件里塞**，于是每次都卡在"改一处、动全身"。
- 结论：**不要推倒重来**，把已验证的 core/adapters 保留；**只对 UI 层做"外科手术式"重构**，从巨型组件里抽出 hooks 和 panel 组件。

---

## 二、值得表扬的（别改坏）

1. **纯逻辑与 IO 分离得很干净**。`core/*` 无 DOM、可单测；`adapters/*` 才碰 IndexedDB/localStorage/浏览器 API。`state/session.ts`（跟读）更是一个**不依赖 React 的 ViewModel**，测试直接 `new SessionStore(fakeDeps)`。这是这个项目最值钱的结构。
2. **依赖倒置**（`ports.ts` + 注入假实现），所以"播到块尾自动停""连续跟读整圈"这种最难手动测的逻辑能单测。
3. **AI 交互的"提示词 ↔ 粘回 JSON"模式**选得对：不直连 API（不泄露 key）、可控、可缓存；解析层对不合格结果**直接丢弃**，不糊。
4. **数据分级**想清楚了：词库/录音走 IndexedDB（大、异步），偏好/统计走 localStorage（小、首屏要）。
5. **测试密度高**（537 个），且覆盖的是真会出 bug 的逻辑。

---

## 三、主要问题（按优先级）

### P0 — `ReaderApp` 是"上帝组件"（5840 行 / 112 个 useCallback）

- **症状**：
  - 112 个 `useCallback`，互相依赖（`gradeStudy`→`recordActivity`→`markStudied`→…），**一个改错、看半天**。
  - 声明顺序敏感，出现过 **TDZ / 拿到旧值**，被迫用 `speakRef` / `dictClozeRef` / `libraryLemmasRef` 兜（见 PERF-NOTES #7）。
  - 一个 `applyPaste` 里塞了十几种任务的 `if (lastTask === …)`。
  - 渲染里混着两段巨大的 IIFE（总览仪表盘、统计面板）。
- **代价**：每次加功能，复杂度线性甚至平方增长；新人（或下一个 AI）无从下手；性能坑（O(N²)）也是这么攒出来的。
- **目标**：`ReaderApp` 收敛到 **~300–500 行**，只做"组装"。

### P0 — 派生计算"随词库规模爆炸"

详见 `PERF-NOTES.md` #1/#2。根因是**认知**没分清楚：哪些派生只跟 `doc` 有关、哪些跟 `library` 有关。改造时要把"选择器"分层缓存。

### P1 — 持久化与"散点 IO"

- 虽然已抽出 `useLocalStorageState`（本轮），但仍有 **`batchMapRef`、`writingDraft`、`reader:listening:<文章>`、`reader:last`** 等自定义读写散在组件里。
- **建议**：所有持久化走 `ports`（`StatsRepoPort`/`MistakesRepoPort`/`PrefsRepoPort`），组件只与 `readerStore` 对话。

### P1 — 错误处理被 `catch {}` 吞掉

全项目大量 `catch { // 忽略 }`。IndexedDB 写失败、剪贴板不可用、文件解析失败——用户**看不到任何反馈**。
- **建议**：统一 `flash`/toast 的**错误通道**；IO 失败必须"可见"，至少 console.warn + 轻提示。

### P2 — 日期/格式化工具重复

`localDayKey()` 与 `core/activity.ts` 的 `dayKeyLocal()` 是两份；`fmtDur`/`fmtInterval`/`fmtDue`/`missingWords` 都在 `ReaderApp` 顶层。
- **建议**：`core/day.ts`（一个 `dayKey`）、`src/reader/format.ts`。

### P2 — 键盘管理散落

有 4+ 处 `window.addEventListener('keydown')`，各自判断 `studyQueue/quizQueue/...` 才决定要不要处理。
- **建议**：一个 `useHotkeys(scope, map)` 或集中式 `keyboard.ts`，避免"新开一个模式忘了屏蔽旧的"。

### P2 — 类型边界靠 `as` 硬转

`localStorage` 的 `JSON.parse(...) as X`、事件 `as HTMLElement` 等。读外部数据（备份导入、localStorage、AI 粘回）应做**运行时校验**（手写 guard 或 zod），而不是相信类型。

### P3 — 资产与体积

`big.png`(1.1MB)/`GinShinImapct.png`(1.3MB) 被 import 进 bundle；可用更小的 webp/avif。fish 已静态化（好）。

### P3 — UI 无测试

core 覆盖很好，但没有一个组件/hook 的测试。至少给"抽出来的 hook"补测试（需要引入 `@testing-library/react` 或 `react-test-renderer`）。

---

## 四、重构方案（保留功能，分阶段）

> 原则：**每一步都可构建、可测、可单独提交**；不改变行为，只搬代码。用"绞杀者模式"逐步替换，而不是一次性重写。

### 阶段 0（已做）
- [x] `useLocalStorageState` + 预设，消灭 ~30 处持久化样板（-350 行）。

### 阶段 0.5（已做）：AI 工作包（把手工循环自动化）
- 需求：省掉「复制提示词 → 网页版 AI → 粘回 → 重复」的循环。
- 做法：新增 `core/aiPackage.ts` —— 由当前数据**推导所有待办**（`buildAiJobs`）、打包（`buildJobPack`）、解析结果文件（`parseAiResultPack`/`parseJobPack`），全部纯逻辑 + 单测。
- 组件抽 `applyTaskResult(task, raw, askedWords, askedIds)`，单条粘贴与整包导入共用。
- UI：选词·分析里「📦 导出 AI 工作包 / 📥 导入 AI 结果」。导出的 `ai-jobs-*.json` 可**整包喂给本机 agent**；配 key 时 `npm run ai:pack`（`tools/ai-pack.mjs`）可全自动跑。

### 阶段 1：把 `ReaderApp` 拆成 **ViewModel + 组件**（最大收益）
- [x] 抽出 `panels/StatsPanel.tsx`（统计 Tab 的巨型 IIFE → 组件）。
- [x] 抽出 `panels/DictPanel.tsx`（听写：整句/填空，含换题聚焦）。
- [x] 抽出 `panels/ListeningPanel.tsx`（听力理解）。
- [x] 抽出 `panels/WritingPanel.tsx`（仿写 + 历史，历史展开改为组件内 UI 状态）。
- [x] 抽出 `panels/StudyPanel.tsx`（背单词/快刷 + 卡内编辑 + SRS 评分）。
- [x] 抽出 `panels/QuizSetupPanel.tsx` / `QuizPanel.tsx` / `QuickPanel.tsx`（考试设置/答题/快刷）。
- [x] 顺带把 `fmtDur/fmtInterval/fmtDue` 提到 `reader/format.ts`，考试焦点 effect 移进 QuizPanel。
- [x] 拆侧栏 Tab：`SideOverview`（仪表盘+错题本）/ `SidePick`（选区/任务/粘回/AI 工作包/整理）/ `SideVocab`（生词本+每日统计）。
- [x] 逻辑下沉到 feature hooks：`useSpeaking` / `useAiPack` / `useDictation` / `useQuizSession` / `useStudySession`（会话状态 + 效应都进 hook）。
- [x] 视图拆成 `panels/`：会话面板 7 个 + 侧栏 3 个 + 统计 + 阅读正文 `ReaderBody` + 新建 `Composer` + 顶栏 `ReaderToolbar`（共 14 个）。
- [x] AI 工作包加「网页版（DeepSeek）」路径：复制提示词 / 应用 / 缺项重问 / 分块；长任务（翻译/语言点）按句分块；「全流程」进度面板（持久化）；「范围：本篇/全库」；含自动标词（`core/aiPackage`）。
- [x] 其它纯逻辑与视图拆分：`core/vocabStats`（统计派生）、`useArticleImport`（新建/导入）、`useAiTasks`（提示词复制）、`useReaderDoc`（文章加载/保存/编辑）、`useApplyTaskResult`（AI 回执）、`ReaderBody` / `Composer` / `ReaderToolbar`。
- [ ] 下一阶段：`useSelection`（选区/划词/鼠标事件）。
参照已有的 `state/session.ts` 思路，做一个 **`src/reader/store.ts`**（不依赖 React）：
- 持有 `library / doc / saved / prefs`，以及各练习模式的队列/进度；
- 暴露 `actions`（`grade`、`startStudy`、`applyPaste`、`saveArticle`…）与 `selectors`（`articleWords`、`studyPool`、`readyRows`、`stats`…）；
- 持久化通过注入的 ports，**IO 全部挪出组件**。

React 侧只留：`useReaderStore()` 订阅 + 一堆**展示型组件**：

```
src/reader/
  store.ts            纯 ViewModel（reducer + actions + selectors，可单测）
  hooks/
    useReaderStore.ts 订阅 store（useSyncExternalStore）
    useLocalStorageState.ts   ← 已做
    useSpeak.ts        TTS（speak/stopReadAll）
    useHotkeys.ts      集中按键
  panels/
    ReaderBody.tsx     正文（句子渲染/选词/TTS）
    Composer.tsx       新建/导入文章
    StudyPanel.tsx     背单词 / 快刷
    QuizPanel.tsx      考试（含设置）
    DictPanel.tsx      听写（整句/填空）
    ListenPanel.tsx    听力理解
    WritePanel.tsx     仿写
  Sidebar.tsx          三个 Tab 的壳 + 各 Tab
    SideOverview.tsx   仪表盘 + 错题本
    SidePick.tsx       选区/任务/粘回/整理
    SideVocab.tsx      生词本
    SideStats.tsx      统计
  ai/
    tasks.ts           AI 任务注册表（见阶段 2）
  format.ts / day 相关
```

- 每个 panel 只接自己需要的 props（或直接读 store 的选择器）。
- `applyPaste` 的巨型 switch → 阶段 2。

**验收**：`ReaderApp` ≤ 500 行；`npm test` 仍全绿；行为一致。

### 阶段 2：AI 任务抽象成**注册表**
- [x] 先把 `applyPaste` 的 `if` 链抽成 `applyTaskResult(task, raw, …)`，单条粘贴与整包导入共用（为注册表铺路）。
- [ ] 进一步把「build 提示词 / parse / apply / report」收进一个 `AiTask` 对象：

把 `lastTask` + `applyPaste` 的 `if` 链，换成：
```ts
interface AiTask {
  kind: string
  build(...): string          // 生成提示词
  parse(raw): T | null        // 解析（严格）
  apply(data, ctx): void      // 落库/落文档
  report?(data): string[]     // 回执
}
const TASKS: Record<string, AiTask> = { lookup, translate, confusable, lemma, pos, listening, language, imitation, feedback, ... }
```
新增一种 AI 功能 = 加一条；`applyPaste` 只 `TASKS[lastTask].parse/apply`。

### 阶段 3：选择器分层 + 性能护栏
- `docDocSelector`（只随 doc）、`libSelector`（随 library）、`combined`。
- 加一条"护栏"：**render 里禁止调用会遍历 library/doc 的函数**（可用 lint 规则 / code review checklist）。
- 大集合先索引成 `Set`/`Map`（`sentenceLemmas`/`docLemmas` 已是范例）。

### 阶段 4：健壮性
- 统一错误上报（toast）；边界运行时校验（守卫函数）；`@testing-library` 给 hook/组件补测。

### 阶段 5：资产与依赖
- 大图转 webp/avif；移除未用的依赖（`jszip` 仅导入 epub 时用，确认按需）。

---

## 五、设计意见（一句话版）

1. **UI 只负责"画"和"转发事件"；逻辑进 store，IO 进 ports。** 这是本项目已经验证过的最佳路径（跟读页 `SessionStore` 就是证明）。
2. **数据结构分层**：`raw → 索引 → 派生`。派生计算要显式声明"依赖什么"，不能混。
3. **一种 AI 任务 = 一个对象**，别用 `if` 链。
4. **所有持久化只有一个入口**（store + ports），组件里不许出现 `localStorage`。
5. **每次交互都在"热路径"上**：热路径只允许 O(1)/O(N) 且与文档无关的计算。
6. **错误不允许静默**：IO/解析失败必须让用户看见。
7. **可测性优先**：能写成纯函数/ViewModel 的，就别写进组件。

---

## 六、建议的推进顺序（给下一步）

1. **阶段 1 的第一刀**：先把 `state` 里"纯逻辑"的派生（`studyPoolFor`/`articleWords`/`readyRows`/统计）搬进 `reader/store.ts` 的 selectors，并补测试。组件里只调用选择器。
2. **第二刀**：抽 3 个最独立的 panel：`DictPanel`、`ListenPanel`、`WritePanel`（它们主要是"一次性会话"，props 相对少）。
3. **第三刀**：抽 `SideStats` / `SideOverview`（把两个 IIFE 变组件）。
4. 之后按阶段 2/3 收尾。

> 每刀都要求：`npm run build` + `npm test` 全绿、行为不变、单独 commit。
