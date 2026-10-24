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
  ReaderShell.tsx  页级布局外壳（工具栏 / 正文 / 右侧栏三个 slot、页级皮肤）
  ReaderArticle.tsx 正文区（标题 + 编辑态 + ReaderBody）
  SessionHost.tsx   会话面板路由（背词/考试/快刷/听写/听力/仿写 → 对应 panel）
  panels/ReaderSidebar.tsx 右侧栏（页签 + 五个面板的接线）
  ReaderSidebarHost.tsx 右侧栏宿主（hook 整包 + 派生值 → 五组面板 props）
  ReaderToolbarHost.tsx 顶栏宿主（文章管理 / 朗读 / 预生成 / 统计 / 显示设置 → ReaderToolbar）
  ReaderApp.tsx  组装：状态总线 + 把 hooks/panels 接起来
  reader.css     样式入口：只按固定顺序 @import styles/ 下 8 个分片
  styles/        按功能拆的样式分片（基础 / 侧栏顶栏 / 选词与 AI / 背单词 / 语言点与计划 / 选择器 / 主题与考试 / 速读与编辑）
src/ui/          跟读练习（旧模块，独立于精读词库）
  App.tsx         页面装配：建 store、挂本机偏好、全局快捷键，其余交给下面六个区块
  ChunkList.tsx   左侧块列表（含自动滚到当前块；计数/✂ 查表）
  AppBanners.tsx  顶部提示条（notice / 麦克风电平低 / 解码中 / 打不开）
  CycleRow.tsx    连续跟读：开关 + 说完静音多久 + 本轮状态
  TransportBar.tsx 播放控制：上一块/播放/下一块、语速、切块档位、撕开开关；另出 AbCompareRow
  AlignmentRow.tsx 对齐校准：正文起点 + 文字整体偏移
  RecorderPanel.tsx 录制区：录音按钮 + 电平表 + 麦克风/音质/回放放大
  ScriptPanel.tsx 原文面板（整篇摊开、当前块高亮、选字定块、锚点微调）
  AppBits.tsx     空状态 / 备份条 / 录音导出与列表 / 时间格式化
  ChunkSplitter.tsx 波形撕块面板；FishLayer.tsx 背景动效
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
| 词条「类型」相关的判断与标签 | `src/core/entryKind.ts` | **SSOT**，视图不许再抄一份字面量（R5）。`isStudyable` 判定「能不能背/考」：用法笔记（中文说明）不进卡片；**无释义的卡也不进**——没中文意思选义题出不了、卡片只能显示「无释义」，先去补释义（2026-10-24） |
| 语言点（词组/习语/用法）的收集与键规则 | `src/core/langPoints.ts` | 与 `vocab.ts`（单词规则）分开 |
| 语言点手动编辑（表单 ↔ 数据、多行拆条、列表摘要、旧数据归一） | `src/core/language.ts` | `getSentenceLanguages` 负责兼容老数据（单条 `language`、列表字段是字符串）；结构 / 语法的换行与缩进原样保留。阅读 / 速读共用 `panels/LanguageEditor`；正文 / 速读 / 日志共用 `panels/LanguageLines`。**点遮罩不关闭**，只有「保存 / 取消」能关；点输入框展开、点框外收回 |
| 单词的词形 / 合并 / 排期规则 | `src/core/vocab.ts`（对外出口）+ `src/core/vocab/*` | 子模块按职责分：`word` / `merge` / `analysis` / `library` / `review`；新规则放进对应子模块，别把 facade 再撑大 |
| 打印/导出的「选哪些条目」 | `src/core/printPlan.ts` | 面板只收集选择 + 渲染 |
| 日期键（今天/哪天） | `src/core/activity.ts` | `dayKeyLocal`（逻辑日，04:00 结算）/ `calendarDayKey`（日历日）；**不许自己拼**（R6） |
| 学习记录「重建派生后对账」 | `src/core/learningCheck.ts` | 只比派生聚合（活动 / 题型统计），不比 `practice` 等原始记录（会把「还没同步」误报成差异） |
| 跟读：录音时长 / 电平阈值 / 说完静音判定 | `src/core/recording.ts` | 纯函数（`recordCapMs` / `voiceThreshold`）；别再往 store 里塞魔数 |
| 跟读：原文怎么摊到块上、锚点怎么解析 | `src/core/scriptAlign.ts` | 「有锚点用锚点，否则跳过引子按比例摊」这条选择规则只在这一次 |
| 跟读：锚点随撕开 / 合并怎么变、微调夹取 | `src/core/anchorEdits.ts` | 纯算术，界面只回传 `edge/delta` |
| 跟读：录音与块的对应 | `src/core/takeChunk.ts` | 块号会变，一律按音频时间重算（`remapTakes`） |
| 跟读：每篇的手动校准账本 | `src/state/calibrationLedger.ts` | 空数组 = 删键；`persist` 里空的键不写（保持老记录形状） |
| 跟读：本机偏好（显示模式 / 麦克风 / 静音时长） | `src/state/shadowingPrefs.ts` | 读写都兜底；`ui/` 里不许再碰 localStorage（R3） |
| 顶栏按钮区多宽 | `src/core/toolbarWidth.ts` | 默认 `fit-content`（按钮多宽就多宽）+ 800 下限 + 视窗上限；档位 auto/窄/宽/铺满 存本机（`reader:toolbarWidth`），展示层只拿算好的 style |
| 顶栏按钮区分几行 | `src/core/toolbarRows.ts` | 四组控件（文章 / 视图 / 动作 / 统计）→ 4 / 3 / 2 行：从尾部并（统计最矮，跟动作并）。`ReaderToolbar` 只按 plan 铺行，不改顺序；合并行插 `.tb-sep` 竖线，档位存 `reader:toolbarRows` |
| 文章键（「同一篇」怎么认） | `src/core/docSignature.ts` 的 `articleKey` = `标识@正文签名` | 签名只由句子文本算（djb2，句间有分隔）。**凡按文章记东西，键里都要带它**：标识可能是书名 / 空标题 / 「未命名」。滚动进度 / 速读游标与本页清单 / 听写游标 / 听力题缓存**一律用 `articleKey`**，不许各自拼 |
| 阅读页滚动到哪 | `src/core/scrollProgress.ts`（比例口径、脏值兜底）+ `src/state/scrollPrefs.ts`（`articleKey` 存，内存优先） | 存比例不存像素：换字号/衬线/译文后还能回到同一段；`ReaderShell` 只拿 hook，不碰 localStorage（R3） |
| 速读「读到第几句」 | `src/core/speedRead.ts` 的 `speedCursorKey(articleKey)` | 只按标识存会串篇（空标题 / 同名 / 「未命名」共用一个标识）；读完最后一句退出即清零 |
| 装饰鱼放哪 / 多大 | `src/core/fishLayout.ts`（范围夹取、脏值兜底）+ `src/state/fishPrefs.ts`（按页面存/读） | 视图只管拖拽手势；R3 存量豁免只剩 `core/stateBackup` 一条 |
| 需要读写存储/网络 | `src/core/ports.ts` 定义端口 → `src/adapters/*` 实现 | 内存兜底实现放同文件（隐私模式） |
| AI 结果落地（解析表格 → 写库 + 回执） | `src/core/aiApply.ts` | 六个表格型任务；自动标词（要离线词典）与查词（要来源句）仍留在 `useApplyTaskResult` |
| 考试「考哪些词 / 每词出几题」 | `src/core/quizPool.ts` | 范围 × 题型 → 候选词与题量；设置持久化在 `hooks/useQuizSettings` |
| 出题素材（答案归一化 / 挖空 / 干扰项 / 语法标记 / 洗牌） | `src/core/quizParts.ts` | 从 `quiz.ts` 抽出；题型枚举、`makeQuestion`、判分仍在 `quiz.ts`，公开 import 不变 |
| 服务端跑批（起跑 + 轮询 + 取消） | `src/adapters/aiRun.ts` | 有界（40 分钟超时 / 连续 20 次失联）+ 可取消；runId 由客户端生成并随启动请求发过去，服务端**先占位再读 body**，所以启动响应还没回来时点取消也能停；取消先 `POST /api/ai/cancel` 停服务端，再打断本地轮询；hooks 里别自己 `fetch('/api/ai/run')` |
| 有状态的交互流程 | `src/reader/hooks/use*.ts` | 一个 hook 一件事；**同一份状态只允许一个写入方** |
| 全局键盘 | `src/reader/useHotkeys.ts` + `hotkeys.ts` | 只允许一个全局分发器，按优先级启用当前模式；禁止再直接 `window.addEventListener('keydown')` |
| 面板 / 列表 / 对话框 | `src/reader/panels/*.tsx` | 不准塞领域判断；判断回 core |
| 词库自动补全（例句/收藏…） | 加进 `src/core/libraryAutoFill.ts` | **不许再写第二个 effect 去读写词库**（见下） |
| 背单词的「加练 / 重练忘记的」出场次数 | `src/core/vocab/extra.ts` | 评「忘记了」就追加到队尾，**不封顶**，直到评「认识 / 模糊」；模糊即收尾、不再追加；「重练忘记的」每轮只发起一次。hook 只调 `planExtra` / `planRetryForgot`，不改评分 |
| 背单词计时（单卡 / 本轮总时长） | `src/reader/hooks/useStudyTimers.ts` | 归零只看换卡 / 换轮；`paused`（卡内编辑）只停表不归零，停表前把未落盘秒数补记 |
| 单词「学过没有 / 要不要复习」 | `src/core/vocab/review.ts` 的 `isFresh` / `hasReviewHistory` / `isRelearning` | 别再看 `repetitions === 0`：答错后它也会归零；新词 = 从未排期（interval 0 + due null + 非重学） |
| 拼写判错 → 判为「不认识」 | `src/core/vocab/spelling.ts`（`spellingMatches` / `markSpellingMiss`） | 一次判定：SRS again + `relearn + 1` + 「不认识」标签；会话负责重排与锁导航，视图不算规则 |
| 背单词「学习新词」这一步怎么判 | `src/core/vocab/learnStep.ts` | 看答案 / 选错 = 不认识（again），首次选对 = 模糊（hard，防蒙对），第二次起 = 认识（good）；词库不足 4 个释义时 `fallback` 退回普通卡。停留时长 `LEARN_REVEAL_HOLD_MS`（可打断）。选对次数记在 `ReviewState.meaningPasses`（跨轮持久，判不认识归零） |
| 背单词「选中文释义」的四个选项 | `src/core/vocab/meaningOptions.ts` | 正确 + 3 干扰项，卡 id 做种子的稳定哈希定序；`correctOptionIndex` 供「揭示答案时给正确项上浅绿」用。视图与会话共用这一份，不许各算一套 |
| 背单词「复习单词」三键 | `src/core/vocab/reviewStep.ts` | 看见单词就能判，不用先翻面：认识 → 直接写 good 并换下一张；模糊 → **先不落库**、摊卡等「下一词」（hard）/「记错了」（again）；忘记 → 立刻 again 并停卡。模糊先不写库是为了「一次决定一次落库」——先 hard 再 again 会在统计里算两次、还把刚加的 repetitions 又清零 |
| 背单词的键盘映射 | `src/reader/hooks/useStudyHotkeys.ts` | 面板上每个按钮都标了对应键：空格/回车 = 主操作（看答案 → 继续 → 下一词；复习模式 = 看一眼释义）、H = 看答案、1/2/3 = 认识/模糊/忘记了、U = 不认识、M = 记错了、R = 朗读、Q/E = 上一个/下一个、Esc = 结束。「看答案」用 H 而非 A：释义题的 A/D 是左右切换选项 |
| 背单词「组末拼写测试」（学习模式） | `src/reader/hooks/useStudySpellingRound.ts` + `src/core/vocab/review.ts` 的 `groupEndOf` | 学了多少拼多少（本组全部，不封顶）。`groupEndOf(index, total, size)` 按队列位置切组，size≤0 或 ≥total = 整轮一组；每组大小存 `reader:studyGroupSize`（0 = 跟随范围）。拼错判「不认识」并落库，显示英文原文要求照着重打（输入为空才显示原文），重打不改判定；全拼完主 hook 才把 index 推到组末。正面拼错的卡面状态机在 `hooks/useStudySpellGate.ts`——拆出去的 hook 只管界面状态，落库仍只有主 hook 一个写入方 |

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
- 按篇收录 / 编号 / 语境释义：`core/articleVocab.ts`（`ArticleVocabEntry` 唯一 SSOT）、
  `core/articleNums.ts`、`core/articleMeaning.ts`。视图里不许再过一遍「正文 ∩ 词库」。
- 句子原文共享：`core/vocab/sentenceTexts.ts`（落盘 `compact`、读出 `hydrate`；同一句只存一份）。
- 打印范围/内容/分组：`core/printPlan.ts`（同时是文案来源 `PRINT_*_LABEL`）。
- 日期：`core/activity.ts`。
- 语言点的键与签名：`core/langPoints.ts`。
- 易混项来源：`core/vocabConfusables.ts`（`ai` / `dict`；旧数据没有来源就不标，不按内容猜）。
- 词条核心字段来源/锁定：`core/vocabFields.ts`（音标 / 词性 / 中文释义 / 英英释义；
  `ai` / `dict` / `manual`；手动改过的字段才锁，旧数据仍按 `edited` / `mastered` 整条锁）。
- 背单词「标过不认识 → 复习/加练先选中文释义」：`core/vocab/review.ts`
  （`needsMeaningCheck` + `canQuizMeaning`）；视图只根据结果渲染，不再自己判断。
- 背单词「加练 / 重练」的出场账本：`core/vocab/extra.ts`（`planExtra` / `planRetryForgot`）；
  评「忘记了」就重排到队尾，**不设次数上限**（练到用户自己评认识/模糊为止）；「模糊」是收尾条件，
  不再追加；「重练忘记的」每轮只发起一次。复习侧靠 `ReviewState.relearn` 把它排进下次复习队列最前，
  hook 不许再自己数出场次数。
- 背单词计时：`hooks/useStudyTimers`（`paused` 暂停、每 15s 落盘）；卡内编辑的时间不算学习时长。
- 复习状态分类：`core/vocab/review.ts` 的 `isFresh` / `hasReviewHistory` / `isRelearning`；
  `ReviewState.relearn` 是进入重学的唯一标记（again 时 +1，连续两次答对才清零）。
  **不要用 `repetitions === 0` 判新词**：答错会把它归零，那样「记住过又忘」的词会掉回新词、
  从复习队列消失，还重复占每日新词配额。
- 拼写判错：`core/vocab/spelling.ts`。`spellingMatches` 只忽略大小写/空白，不做词形兜底；
  `markSpellingMiss` 写 again + `relearn` + 「不认识」。会话（背单词 / 考试）判定后必须锁住
  「再输一次 / 下一题 / 退出」，确认后才允许继续；重排由 `useStudySession.applySpellingMiss` 做。
- 选「忘记了」= 确实忘了：直接按 again 落库（repetitions 归零、进入重学），**不再弹二次确认**。
  用户点忘记已是明确表态，多一步「确实忘了 / 其实记得」是冗余（2026-10-24 移除）。
- 超时「强制锤炼」该不该出现：`core/vocab/drill.ts` 的 `shouldDrill`。锤炼是**评分门禁**
  （先做题才允许评分），所以「已经判完、停在卡上等下一词」（`parked`：学习判完 / 复习已判 /
  模糊待定）、学习模式四选项那一关、拼错判定页，一律不触发。
  踩过的坑：学习模式选错释义 → 判 again → 这个词立刻成了 `isRelearning`，
  点「继续（看单词卡）」的同一帧就命中「重学卡摊开释义 → 锤炼」分支，
  单词卡一帧都没露就被锤炼接管；复习模式按「忘记了」同样。**判完的卡不需要再门禁一次**。
  第二个坑（2026-10-22）：重学卡的「摊开过释义」一旦为真就一直为真，过完面板会**原地重开**，
  用户写完搭配也退不出去。所以「本卡本轮已锤炼完」由 `cleared` 统一兜，两条触发各自不用再记。
- 锤炼的步骤顺序：`panels/StudyDrill.ts` 的 `buildSteps`。拼写 → 选词义 → **看卡** → 写搭配
  （有哪步数据才出哪步）。选词义之后、写搭配之前必须插一步「看单词卡」：让用户先看清词形 +
  释义再写搭配，直接考搭配用户想不起来（2026-10-24 加）。锤炼做完回单词卡的那个展示在
  `useStudySession.clearDrill` 之后，不在这里。

### 2.4.1) 词形只做屈折还原，派生词是另一个词

- `core/vocab/word.ts` 的 `canRewriteTo(from, to)` 是**改词条 word/lemma/id 的唯一闸门**：
  只放行屈折（-s/-es/-ies/-ed/-d/-ing/-n/-en、双写尾辅音、去 e、y→ies、-ses→-sis、不规则表），
  加/去**派生**词缀（un-/in-/dis-/non-… 前缀，-ly/-ness/-tion/-er/-al… 后缀）一律拒绝。
- 为什么：`-ing/-ed 辨析`（`applyPosAnalysis`）与「原形校正」（`applyLemmaMap`）都会拿 AI 给的「原形」
  改词条 `word`。改名**只动 word/lemma/id，不动释义/用法/例句**，AI 又常把
  `unchallenged` 的「原形」写成 `challenge` —— 于是 `challenge` 卡上挂着
  `a. 未引起争论的`，词性和释义全错位（2026-10-22 用户报的四个词）。
  拒绝的代价只是「词形没被规整」，误改的代价是整张卡张冠李戴，所以宁严不宽。
  `applyLemmaMap` 本身是哑映射（离线词典的词形表也要用它），**过滤放在 `core/aiApply` 的 AI 边界**。
- 同一类问题的另一半：**词性与释义必须同源**。词典（ECDICT / M-W）给的是词头**首义**的词性，
  AI 查词给的是**语境义**。所以 `applyWordAnalysis` 在释义被换掉时让词性跟着换（AI 没给就清空），
  `dictEnrich` 只在同批补释义时才补词性，`ecdict.glossForPos` 按词性挑释义行。
  卡内编辑只提交**改过的**字段（`editItem` 会把传入的每个字段标 `manual`，全传＝整条锁死）。
- **词典给的词性只是占位，AI 看过语境就由 AI 定**。`fieldSources.partOfSpeech === 'dict'` 表示
  这个词性是词头首义、不是语境义，此时 AI 重查只要给了词性就覆盖它——**哪怕释义一字未变**
  （`rival` 真实病例：义项早就是「与……匹敌」，但 dict 的 `n.` 一直压着，因为旧逻辑
  「释义没变就不动词性」，重查多少次都改不回来）。反过来，释义换了而 AI 没给词性时**宁可清空**，
  不允许「旧词性 + 新释义」凑一对。  查词提示词里把这条写死：词性按上下文用法定，
  词性/中文含义/搭配/例句/英文释义**五样同属一个义项**。
- **这条不变量由 `core/vocab/sense.ts` 守，不靠各写入方自觉**：
  - `reconcileSense(item)`：释义自带词性标记（`n. 誓约` / `vt. 引起`）时词性跟它走，用户手填的不动；
    `applyWordAnalysis` / `enrichWithDict` / 词库自动补全出门前都过一遍；
  - `useApplyTaskResult` 的回填：**AI 给了释义却没给词性时，词性留空**，绝不拿词典词头首义顶上；
  - `tool/check_vocab_sense.mjs`（在 `npm run gates` 里）把两类硬矛盾判为失败：
    ① 词性与释义首标打架、② 单词条目的 word 被污染（`term ... ...`）；
    「词典占位词性 + AI 语境释义」只告警（可能对，也可能像 `rival` 那样错），需要重查确认。
  - 词组 / 用法笔记（`kind` 非空或 word 带空格）不参与这套判断——它们没有「词性」这回事。
- 存量数据用 `tool/audit-vocab.mjs` 体检（A 词形被改成派生词 / B 词性与释义首标打架 /
  C 英英是动词义却标名形）；`--fix` 走和线上一样的 `openStore → saveVocab` 事务路径。

视图里**不许**再出现这些规则的第二份实现（门禁 R5/R6 会拦）。

### 2.5) 每篇生词独立：全局一条，按篇一层

- `VocabItem`（`library.items`）仍是**复习 / 词义主数据**：一个 lemma 一条，背单词只背一次。
- `ArticleVocabEntry`（`library.articleEntries`）记**这一篇收了哪些词**：`articleId + lemma + origin +
  via + addedAt + 语境释义 + printedAt`。本篇列表、编号、正文高亮、按篇打印都只读这一层。
- **新文章不继承总词库**：不许再用「正文里出现过 + 词库里有」判断本篇归属；只有自动标词 / 手动加入
  / 语言点自动收藏会写条目。词组 / 习语 / 用法也收进本篇（侧栏语言点页签），但 `articleNums` 只给单词编号。
- 编号 = 本篇条目数组的下标 + 1（加入顺序），删除后自然重排；自动 / 手动共用同一套编号。
- `origin` 只保留粗粒度 `auto / manual`（打印、老逻辑用）；**细分来源看 `via`**（`ai / dict / manual /
  language / auto / batch / legacy`）。合法值与守卫只在 `core/vocabVia.ts`，UI 显示时优先 `via`、
  没有才退回 `origin`；旧数据无法还原具体来源时用 `batch / legacy`，**不按时间反推**，也不许猜成「手动」。
- 打印是「按篇行」：`core/printPlan.ts` 产出 `PrintRow { item, articleId, number, meaning }`，
  同一词在不同篇各有一行、各用本篇编号，不再按 lemma 跨篇去重。
- 本篇语境释义来源：`ArticleVocabEntry.meaningSource` 由 `core/articleMeaning.ts` 的
  `resolveArticleMeaning` 解析，列表标签统一走 `meaningSourceLabel`；没有条目释义时不为它标来源，
  也不拿词条 `fieldSources.meaning` 冒充本篇来源。
- 已保存文章来源：`SavedArticle.origin`（原文库 / 粘贴 / EPUB / 文件）只在入库边界写，
  合法值与标签在 `core/articleOrigin.ts`；旧文章没有 `origin` 就保持未知，不按 `sourceKey` 反推。

### 2.6) AI 跑批：一次点击排完、回执说真话、闭卷先学

「一键跑批」是把几十个 AI 小任务串起来补数据。它的坑不在调用，而在**看起来没反应**：

1. **待办要一次排完，不许 `slice`**。`pickExamples` / `pickPhrases` / `pickMarks` /
   `pickContextLookup` 以前都是 `.slice(0, 30)`：缺口 90 个，点一次只补 30 个，
   而且被 slice 掉的词下次仍排在队首 —— 用户看到的就是「点十次还在补同一批」。
   现在它们返回**全量**，`exampleChunks` / `phraseChunks` / `markChunks` / `contextChunks`
   负责按 30 个切块，`buildAiJobs` 每块一条任务；`countAiJobs` 必须用同一组 chunk 函数计数。
2. **「查过」不等于「查到了」**。`pickNeedInfo` 原来只认 `status === 'unqueried'`，
   于是模型漏掉的词永远停在空卡状态，面板上「有释义 308/497」怎么点都不动。
   现在：**没有释义的都要补**（手填过的除外），只差音标的才看 `status`（避免半成品无限重试）。
3. **回执要数实际写入**。`applyExample` / `applyPhrase` 以前拿 `rows.length` 说
   「已加入 N 个词的例句」—— 词形对不上时一行都没写进去，照样报成功。现在数**引用变了的词条**，
   并把对不上的词点名。同理 `useAiPack` 收尾按「成功 / 失败」如实说，不再一律「完成」。
4. **「本轮都跑过了」要问一句**。`pending` 为空时再点就是原样重跑一遍（重新花钱调 AI），
   先 `confirm` 说明「数据没变化多半是模型没返回」；一轮里一条都没应用成功就提前 `break`，
   别让 `settle()` 白等 3 秒。
5. **进度按「问过」算，覆盖率另算**。词块阶段用 `chunksAsked`（`phrases` 字段存在，空数组也算）
   算进度；`withChunks` 只用于产出看板的「词块覆盖」。否则 AI 明确回「无搭配」的词会
   把这一阶段永远卡在 99%，`精通` 等级锁死。
6. **闭卷回忆要先学一遍**。记忆拷打 / 词块拷打是回忆题，直接开考等于让用户猜，猜错还会被当成
   「没记住」写进 SRS 和错题本。`useQuizSession.startDrill(kinds, scope, { warmup })` 先出一道
   `DrillWarmup` 预习卡（词 + 释义 + 词块），点「开始拷打」才 `begin()`；
   卡片内容由**题目反推**（`buildWarmupCards`），不另写一套「考哪些词」的筛选。
   英英释义 / 语法标记 / 听力这些不涉及「没见过」的题型不加预习。

## 三·五、数据安全（事故之后立的规矩）
用户的词库是**唯一资产**，任何重构都不许让它的丢法变多。四条铁律：

1. **单写入口**：词库只由 `hooks/useVocabLibrary.persist` 写；增删动作统一走
   `hooks/useVocabEdits`（只经 `persist`，且以 `libraryRef` 为基准避免连续写互相覆盖）；
   自动补全只由 `core/libraryAutoFill` 这一个 effect 写。新需求加「自动补全」→ 往计划函数里加一格。
2. **读成功才写**：加载态三态（pending/ok/failed）；failed 时 persist 直接拒绝并提示恢复。
3. **覆盖前留快照**：仓储每次 save 追加一版历史（最近 5 版 + 历史最大的一版永久保留，
   SQLite 侧以 gzip 存），`loadPrev()` 取「**刚被覆盖的那一版**」；
   侧栏有「恢复上一版词库」（误清/误导入一键退回）。
4. **写入要带版本号**：前端持有的是**整份**词库，任何保存都是全量覆盖，所以每次保存都带
   `X-Vocab-Base: <读到的 updatedAt>`；服务端对不上返回 409，前端 `persist` 提示
   「别处改过了，这次没保存」。**不带这个头 = 强制覆盖**，只留给迁移脚本和 `tool/*.mjs`。
   详见下面「整份覆盖的代价」。
5. **同一份事实存多处**：词条 ← SQLite(`data/xueba.db`) / IndexedDB 镜像 / 文章 `Sentence.vocab` /
   待选清单(localStorage) / 错题本 / 「导出全部」JSON；语言点 ← 文章 `SentenceLanguage` / 词库里的语言点条目。
   → 坏了就靠「导入备份」＋「恢复上一版词库」；写入侧永远走上面四条。

> 新增「用户资产」时先问：**它有第二份吗？** 没有就先补上第二份，再谈别的。

### 整份覆盖的代价（2026-10-22 两次事故的结构原因）

前端持有整份词库，一次保存 = 全量 PUT。所以有两个必须一起成立的前提：

- **版本号**：`updatedAt` 严格单调递增（同毫秒连存会自增 1ms，否则旧客户端能蒙混过关），
  写回时当作乐观锁的令牌；409 时客户端把服务端的版本号记下来，用户若坚持再存一次才会覆盖。
- **「上一版」的语义是「上一版」，不是「历史最大的一版」**：旧规则「只留条数更大的那份」
  让本库的 8731 条（10-20）永远占着 `vocab_prev`，之后 8306 → 8302 这类缩水根本进不了 prev，
  「恢复上一版」拿到的是两天前的库。**能用 `updated_at` 判断新旧的地方，就不要用条数猜。**

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

**磁盘是跟着写放大走的**（一天一次全量保存就能吃掉几百 MB）：

| 东西 | 策略 | 为什么 |
| --- | --- | --- |
| `vocab_snapshots` | 最近 5 版，**gzip 存 BLOB** | 整库 payload 16MB，明文 6 版就是 96MB；压完 ~2MB |
| `vocab_prev` | 一版，gzip | 同上，只是「上一版」 |
| `vocab` 主表 | 明文 JSON | 导出、体检脚本、`sqlite3` 手工查都要直接读它 |
| `data/backups/` | 每日一份 `VACUUM INTO`，留 5 天 | 防整库文件被删坏；一天 ~60-90MB |
| `-wal` | 每次保存后 `wal_checkpoint(PASSIVE)`，启动与 `close()` 时 `TRUNCATE` | 一次保存写 16MB，PASSIVE 只「并」不「缩」，不主动截断会一直占几十 MB |
| 空闲页 | 启动时 `freelist/total ≥ 15%` 才 `VACUUM` | 删过快照/文章后文件不会自己缩；但别每次启动都全量重写 |

> 数字来自实测：这套策略把 `data/xueba.db` 从 226MB 收到 51MB、`-wal` 从 55MB 收到 0。

## 三·六、吸顶 / 吸底（**按需**使用，不是全局默认）

工具条跟着内容滚跑掉是这一版被提得最多的问题（速读顶栏、速读「读本句/下一句/退出」、
语言点的「语言点（N）+ 条目列表」、保存/取消）。**但吸顶吸底是一种取舍，不是所有界面都该加**：
它拿可视高度换「随时够得着」，加错了就是白白吃掉正文、还多两层边框。

### 什么时候值得吸

- 滚走以后**找不到上下文或操作**：翻页/切句、保存/取消/加入、当前页签或当前条目列表；
- 内容**明显超过一屏**，且用户会在中途反复用那条工具；
- 条本身**矮**（一行按钮 / 一条标题），吸住后仍给正文留足高度。

### 什么时候别吸（默认不吸）

- **一屏放得下**的弹窗、短面板、设置页 —— 吸了只是多两条边框线，用户根本滚不到需要它的位置；
- **侧栏里的窄条**（如背单词的左工具条 `.study-side`）：栏本来就窄，吸住直接压掉可读高度；
- **正文、表单、卡片、列表主体**：这些是「在读/在填」的内容，不该被钉住（也见下面第 6 条）；
- **窄屏 / 手机**：吸顶 + 吸底一起上，正文只剩半屏；真要做就在媒体查询里让它们回到普通流。

### 决定要吸之后，统一按这套写（别每个面板各发明一套）

1. **先认出滚动容器**：`position: sticky` 相对**最近的滚动祖先**算，不是相对窗口。
   精读/速读是 `.reader-main`（`overflow:auto; padding:24px 34px`）；
   语言点编辑器是 `.lang-editor` 自己（`max-height:86vh; overflow:auto; padding:14px 16px`）。
   写之前先在 DOM 里确认谁在滚 —— 容器换了，sticky 全部失效，而且不报错。
2. **负 margin + 等量 padding 抵消容器的内边距**：让吸住的条贴到容器边上、横铺满，
   又不改变「还没吸住」时的位置。源头是精读顶栏 `.reader-toolbar`：
   `margin:-24px -34px 16px; padding:14px 34px 10px;`；
   语言点同理 `margin:-14px -16px 0; padding:14px 16px 8px;`。
3. **底色必须不透明**（页级 `var(--bg)`、面板内 `var(--panel)`），再给 `z-index`（页级 20–25）。
   底色差一点就会出现「正文从按钮缝里穿过去」；`z-index` 还要低于真浮层
   （清单 `40`、对话框 `60`）。
4. **吸底必须抹掉 `.bar` 自带的 `margin-bottom:16px`**，否则吸住时下面漏一条正文。
5. **别拿 `position: fixed` 假装吸底**：fixed 脱离文档流，会盖住最后一屏内容。
   只有真浮层（`.speed-basket-panel`、`.toast`、`.lang-editor-overlay`）才 fixed。
6. **只吸「工具条」**：按钮行、标题 + 条目列表。表单/正文/卡片不进 sticky ——
   两个吸底块叠一起时，第二个就得写死第一个的高度，字号一变就错位。
7. **要一起吸的东西包一层**：标题 + 列表这种组合，包成 `.lang-editor-head` 让**一个**元素 sticky；
   不要把两个兄弟分别 sticky（第二个要写死第一个的高度）。
8. **测试与验收**：jsdom 没有布局，sticky 断言不了。
   结构改动要保证测试用**后代选择器**（`querySelector('.lang-item')`），别写 `>` 直连 ——
   包一层包装元素就全红。改完按 F5 肉眼确认三件事：滚动时条不动、底下不透、按钮贴边。

## 三·七、DOM 嵌套：会进 `<p>` 的组件只能用 phrasing content

阅读正文的段落是 `<p className="para">`，而每句话的译文、语言点、生词高亮都挂在它**里面**。
HTML 规定 `<p>` 只能装 phrasing content（`span` / `b` / `button`…），**不能装 `<div>` / `<ul>` / `<table>` 这类块级标签**。
违反了会怎么样：

- dev 下 React 18 打 `validateDOMNesting(...): <div> cannot appear as a descendant of <p>`，
  一屏警告把真正的错淹掉；
- 真机上浏览器会按容错规则**提前闭合 `<p>`**，后面的节点被挪到段落外，样式莫名其妙错位。

**写法**：进 `<p>` 的组件一律用 `<span>`，块级外观交给 CSS：
`.tr-block`（译文）、`.lang-block` / `.lang-line` / `.lang-src`（语言点）、`.lang-phrases`（词组行）
都是 `display:block` / `flex` 的 `span`。新加「一行一块」的东西照这个写，别顺手用 `<div>`。

**为什么容易漏**：`<p>` 在 `ReaderBody`，渲染 `div` 的是它引用的 `LanguageLines` ——
单看任何一个文件都合法，合起来才非法。所以检查必须**跨组件**：

- 门禁 **R8**（`tool/check_architecture.mjs`）：把 `<p>…</p>` 里引用的自定义组件递归追下去，
  谁渲染树里有块级标签就报谁；
- 回归测试 `src/reader/panels/domNesting.test.tsx`：直接量渲染后的 DOM
  （`p` 后代里不许出现块级元素）。**别改成断言 `console.error` 里的 `validateDOMNesting`** ——
  那条警告按 (childTag, ancestorTag) 全局去重，同文件里前面用例触发过，后面就永远是绿的。

## 三·八、单入口 SPA 与阅读页路由（BrowserRouter，不要改回 hash）

全站只有 **一份 `index.html`、一个 `src/main.tsx`、一棵 React 树**。
`src/main.tsx` 建 **根 BrowserRouter（没有 basename）**，`src/AppRoutes.tsx` 切两段：

```
/                   跟读练习（src/ui/App，StrictMode）
/reader/**          精读 / 生词本（src/reader/ReaderRoot，按路由 lazy 加载）
*                   认不出的地址 → 回 /
```

> 以前是 `index.html` + `reader.html` 两个入口、两个 `createRoot`，互跳整页重载，
> 阅读页面板也拿不到跨文档的历史。现在合并成一个入口；**代码仍然 code-split**：
> `ReaderRoot` 用 `lazy()`，词典 / PDF / 面板只在进 `/reader` 时才下载。
>
> 阅读页 CSS（`src/reader/reader.css`）用 `?inline` 字符串在 `ReaderRoot` 挂载时注入、
> 卸载时删掉。不能改成普通 `import './reader.css'`：那样 Vite 会把 `<link>` 留在 head，
> 从 `/reader` 返回 `/` 后，阅读页的全局 `body` / `button` / `::selection` 规则会继续污染跟读页。

阅读页的路径（`route.ts` 构造，**都带 `/reader` 前缀**）：

```
/reader                         文章列表（没打开文章）
/reader/a/<slug>                读某一篇
/reader/a/<slug>/p/<panel>      读某一篇 + 开面板 / 整页会话
/reader/p/<panel>               没有文章时也能开的（计划/日志/统计/生词本/背单词…）
```

`<panel>` 有两类，都在同一张 `PanelName` 表里：

- **布尔面板**：`intensive` / `speed` / `plan` / `journal` / `export` / `goal` / `stats` / `browse`；
- **整页会话 / 工具页**：`study`（背单词）/ `quiz`（考试）/ `quick`（快刷）/ `dict`（听写）/
  `listen`（听力）/ `write`（仿写）/ `lang`（语言点编辑）/ `compose`（新建/导入文章）。

懒加载面板在 `ReaderOverlaysHost` 里**每个面板各包一层** `PanelBoundary + Suspense`
（`panels/PanelBoundary.tsx`）：某个 chunk 加载失败或渲染抛错时，只换掉这一块并给「重试 / 关闭」，
不要把整个 `Suspense` 放在外层——那样一个面板坏掉会连带其它面板，异常还会冒到整棵树把阅读页打白。
`PanelLoading` 必须带「取消」出口，避免 chunk 一直不回来时用户无路可走。

**为什么整页会话也要进 URL**：它们一打开就占满正文，用户按返回键应该回到「点它之前那一页」
（文章 / 列表 / 上一个面板），而不是直接退出阅读器。接线在：

- `route.ts` 的 `useRoutedPanels`：布尔面板 ↔ URL；
- `hooks/useRoutedFlows.ts`：会话状态 ↔ URL。规则是
  **点按钮打开 → push 一层；浏览器返回 → 关会话；页面内点退出 → replace 掉这一层**。
  深链接打开失败（没词可背 / 没文章）会退回文章页，别停在空界面。

**正文槽位**的四种状态由 `screen/bodyMode.ts` 的纯函数判定（`composer` / `loading` / `missing` / `article`）：
只有用户主动点「新建」才进 Composer；URL 指向文章但索引/正文还没到时显示 loading，
索引里查无此篇显示 missing。视图里不要再写 `composing || !doc` 这种把「还没加载」当成「新建」的条件。

**`<slug>` 不是内部标识**。内部标识长这样：`b:005 Leaders - Post-truth politics`、
`s:saved:1761234567`，直接塞 URL 会变成 `b%3A005%20Leaders…` 一串乱码。
所以地址栏里放的是**由标题算出来的可读片段**：

```
/reader/a/post-truth-politics
/reader/a/elections-in-hong-kong
```

规则在 `core/articleSlug`（`slugify` / `shortHash`）与 `core/articleIndex`（双向索引）：

- 只保留 `[a-z0-9-]`，所以 URL 里永远不会有需要百分号转义的字符；
- 两篇标题撞车（或中文标题被剥成空串）→ 双方都加 `-<4位hash>`。**不是「先到先得」**，
  否则删掉一篇文章会让另一篇的 URL 悄悄变掉；
- 反查要等文章目录 + 已保存列表都加载完（`indexReady`）。索引没好时点文章**直接加载**、
  URL 先留空，索引到齐后自动补上 —— 千万别写成「算不出 slug 就 return」，那是「点了没反应」。
- 补 URL 时如果面板已经开着，要把面板一起带上（`/reader/a/<slug>/p/<panel>`），
  否则会把面板从地址栏挤掉、随后被 `useRoutedPanels` 关掉。

### 返回键的层级（别改成 replace）

`useArticleRoute` 里补 URL 用的是 **`navigate()` 默认的 push**：

```
/ → /reader → /reader/a/<这篇> → /reader/a/<这篇>/p/<面板>
```

返回键：关面板/会话 → 回文章 → 回文章列表 → 才离开阅读页。

**这里曾经用 `replace` 补 URL**，后果是 `/reader` 那一层被覆盖掉，历史里只剩文章页，
按返回直接跳回主界面 —— 用户反馈的「按返回键直接返回主页面」就是它。
刷新时 URL 里本来就有 slug，补 URL 那段会直接 return，所以不会越堆越多。

**四处必须一起改**，漏一处就是刷新 404 / 白屏 / 面板关不掉：

1. **代码**：`src/main.tsx` 的根 `BrowserRouter`（无 basename）+ `src/AppRoutes.tsx`；
   `src/reader/route.ts` 构造**带 `/reader` 前缀**的完整路径。
2. **dev**：`vite.config.ts` 的 `spaRoutePlugin` 把 `/reader*` 与旧 `/reader.html`
   改写成 `/index.html`。
3. **生产**：`server/httpApp.js` 的 `isSpaFallback()` 把前端路由统一回落 `index.html`；
   **带扩展名的缺失资源仍然 404**（旧 `/reader.html` 例外，它要打开阅读页），
   绝不能回落成 HTML —— 否则浏览器把一段 HTML 当 JS 解析，报一堆莫名其妙的语法错。
4. **`base: '/'`（绝对路径）**。相对路径 `./assets/x.js` 在 `/reader/a/<slug>` 下会解析成
   `/reader/a/assets/x.js` → 404。代价是不能部署在子路径下（本地自用，够）。

**老地址**：`src/main.tsx` 的 `normalizeLegacyUrl()` 在 `createRoot` 前把
`/reader.html#/a/x` 换成 `/reader/a/x`、`/index.html` 换成 `/`，收藏夹/外链不会断。

> 曾经用过 HashRouter（`#/a/xxx`）：省掉服务端配置，但 URL 丑、和「返回键回主界面」的
> 层级语义不符。既然要干净的层级，就按上面把服务端一起做掉。

### 新增整页界面 checklist（照抄，别另发明）

以后再加「一打开就占满正文」的会话 / 工具 / 向导 / 编辑器，按顺序做：

1. **先定名字**：在 `route.ts` 的 `PanelName` 里加一格；整页会话同时加进 `FLOW_NAMES`
   （布尔面板和会话共用一套 URL，不要再造 `?open=xxx` 之类的第二套参数）。
2. **写路径构造**：`panelPath(slug, name)` 自动带 `/reader` 前缀；不要把 `/reader` 写死在视图里。
3. **接状态**：布尔面板进 `useRoutedPanels`；会话进 `useReaderFlowRouting` 的 `FlowControls`
   （`active` / `open` / `close` 三个字段），**不要在组件里各自 `navigate`**。
4. **定历史**：按钮打开用 push；页面内关闭用 replace；浏览器返回只负责 `close()`。
   深链接打开失败先 `bump()` 再判，失败回落 `/reader/a/<slug>` 或 `/reader`。
5. **等数据**：需要词库 / 文章 / 当前句的会话，把 `ready` 传进 `useRoutedFlows`；
   没就绪时先不开、也不判失败，避免刷新时被误踢回文章页。
6. **补测试**：`route.test.ts` 测解析 / 构造 / 未知面板；`useRoutedFlows.test.tsx` 测
   push / replace / 返回关闭 / 深链接失败；`useReaderFlowRouting.test.tsx` 测字段映射；
   `AppRoutes.test.tsx` 测两段路由。用 `Link` 的组件测试包 `MemoryRouter`。
7. **查回落**：dev 的 `spaRoutePlugin`、生产的 `isSpaFallback()`、旧地址 `normalizeLegacyUrl()`、
   `base: '/'` 四处对齐；`/assets/missing.js` 必须还是 404。
8. **收样式**：阅读页 CSS 用 `?inline` 在 `ReaderRoot` 注入 / 卸载；静态 `import './reader.css'`
   会把全局规则带到 `/`，不要改回去。

### 首屏：慢在哪，怎么量

别凭感觉。两条命令：

```bash
curl -s -o /dev/null -w "%{time_total}s\n" http://localhost:5173/reader      # dev
curl -s -H 'Accept-Encoding: gzip' -o /dev/null -w "%{size_download}B %{time_total}s\n" <bundle>  # 生产
```

已经落地的四条（都是实测数字，不是"应该会快"）：

| 做法 | 为什么 |
|---|---|
| **HTML 里的骨架屏**（`index.html` 内联，按 `data-entry` 只在 `/reader*` 显示） | JS 下载/解析期间有轮廓，不是白屏。`createRoot().render()` 会清空容器，不用手动移除 |
| **水合先于挂载**（`ReaderRoot`） | 学习记录以 SQLite 为准：先把服务端记录落进 localStorage，再挂 `ReaderApp`。旧做法「本地有记录就立刻画、后台水合」会让 React state 用旧缓存初始化，随后一改就反过来盖掉服务端更新。本地服务正常时只多几十毫秒；静态部署 health 很快失败；最坏等 3s 也先画 |
| **面板 `lazy()`**（`ReaderOverlaysHost`） | 8 个浮层首屏不加载。dev 少 17 个模块 / 1.4MB，生产首屏 chunk 637KB → 586KB |
| **dev `server.warmup.clientFiles`** | 启动时把首屏模块先转译好，避免第一次打开时 200+ 模块、最深 7 层的 transform 瀑布 |

**dev 与生产差多少**（2026-10-23 实测）：

| | 首屏要拿的东西 |
|---|---|
| dev（vite） | **219 个模块**，独立请求，import 瀑布最深 7 层 |
| 生产（`npm run app`） | **1 个 chunk 586KB → gzip 203KB** + 一个 css |

所以「首屏还是慢」先确认跑的是哪个：日常开发用 `npm run dev`（有 HMR，慢是 vite 的固有代价），
要看真实体感用 **`npm run app`**（build + 起生产服务，同一个 5173 端口）。

⚠️ `server/httpApp.js` 的静态服务现在会 **gzip 文本资源**（js/css/html/json/tsv，>1KB，
按 mtime+size 缓存结果）。这个以前是缺的 —— 586KB 的 bundle 一直明文发。

## 四、有意为之的例外（别当违规修）

- **单词和语言点共用一份词库存储**（`VocabItem.kind` 区分）。
  取舍：打印/导出的「按篇 / 按日期 / 未打印 / 分组」整套选项可以零成本复用；
  代价是显示层要按类型分开渲染（侧栏「生词 / 语言点」两个页签，`LangPointList`）。
- **`ReaderApp.tsx` 679 行（800 行硬门禁内，余量 121 行）；视图在 `ReaderScreen.tsx`（189 行）+ `screen/` 三个槽位**：
  路由/面板接线已经抽到 `hooks/useReaderRouting.ts`（`useReaderPanelRouting` / `useReaderArticleRouting`），
  本机临时状态（粘回框 / 高亮气泡 / 文章正文选区）抽到 `hooks/useReaderLocalState.ts`，
  分组模型 → 平铺 `ReaderScreen` props 的翻译层在 `ReaderScreenFromModel.tsx`。
  再往里加东西先抽 hook，别顶门禁。它现在只做装配：状态声明、hook 接线、
  把结果拍平成 `ReaderScreen` 的 props。**两种"分叉"要警惕**：
  同一份数据两个写入方、同一套规则两处实现 —— 都拆到下面列出的 hook / core 里。外壳/正文/侧栏已抽到 `ReaderShell` / `ReaderArticle` / `panels/ReaderSidebar`；
  九个浮层开关（速读/计划/精读/日志/导出/备忘/统计/全部生词 + 日志选中日期）整包在 `hooks/useReaderPanels`，
  阅读页只关心「哪块盖在正文上」，别再往组合根里塞 `useState`。
  **props 只在两处还是平铺的**：`prefs`（18 个本机偏好）与 `articleVocab`（本篇生词口径）走整包
  （`prefs={prefs}` / `articleVocab={articleVocab}`），由 zone 自己取 —— 平铺过一遍的代价是
  `ReaderScreenProps` 得把这两个 hook 的每个类型再抄一遍，抄漏一处就是两套类型；其余字段仍是平铺。
  练习面板路由在 `SessionHost`，侧栏接线在 `ReaderSidebarHost`，顶栏接线在 `ReaderToolbarHost`，
  `screen/ReaderToolbarZone` / `ReaderSidebarZone` / `ReaderBodyZone` 只做「props → host」映射（不读存储），
  学习记录「重建并核对」在 `hooks/useLearningRebuild`（挂进 `hooks/useLearningData` 一起返回，避免再多一个装配点），
  派生统计簇在 `hooks/useReaderDerived`，词库增删 / 评分 / 编辑在 `hooks/useVocabEdits`，复述 / 略读动作在 `hooks/useLearningData`，错题重练 / 包围战在 `hooks/useMistakeActions`，本篇派生在 `hooks/useArticleDerived`，就绪清单 / 日志 / 打印索引在 `hooks/useReaderViewData`，文章工作区 / 新建导入在 `hooks/useArticleWorkspace`，六种会话与错题重练在 `hooks/useSessionServices`，AI 复制/工作包/粘回在 `hooks/useAiServices`，正文小动作在 `hooks/useArticleUiActions`；布局/槽位在 `ReaderScreen`（只做映射，不读存储），提示词复制在 `hooks/useAiTasks`，粘贴应用在 `hooks/usePasteApply`，本机偏好（18 个小开关）在 `hooks/useReaderPrefs`，本篇生词口径在 `hooks/useArticleVocabView`，精读工作流的阶段→工具 / 拷打→题型两张表在 `hooks/useIntensiveActions`，修饰键与队列自动朗读在 `hooks/useModifierKeys` / `hooks/useQueueAutoSpeak`，
  考试设置（题型/范围/题量/鞭打）在 `hooks/useQuizSettings`（候选池与出题集在 `core/quizPool`），
  AI 结果落地规则在 `core/aiApply`、服务端跑批客户端在 `adapters/aiRun`，
  软上限 800 行（上帝文件门禁的线）。
- **展示层已经不再直接读写 localStorage**：`ui/App` 的偏好搬去 `state/shadowingPrefs`、
  `ui/FishLayer` 的布局搬去 `state/fishPrefs`（规则在 `core/fishLayout`），
  `ReaderShell` 的正文滚动位置搬去 `state/scrollPrefs`（规则在 `core/scrollProgress`，
  节流与恢复在 `hooks/useReadingScroll`）。R3 的存量豁免
  现在只剩 `core/stateBackup` 那条 R6（备份文件名里的 UTC 日期，故意的）。
- **跟读模块的「规则」和「偏好」不再住在页面里**（2026-10 拆的）：
  - 录音判定与兜底时长 → `core/recording`（说完静多久、最多录多久、电平阈值）
  - 原文摊到块上的选择规则 → `core/scriptAlign`（有锚点用锚点，否则跳过正文前的引子再按比例摊）
  - 锚点随撕开/合并怎么变 → `core/anchorEdits`
  - 录音挂哪一块 / 每块留最新一条 → `core/takeChunk`
  - 每篇手动校准的账本（平移/起点/锚点/撕合 + 持久化形状）→ `state/calibrationLedger`
  - 本机偏好（显示模式/麦克风/静音时长/回放放大）→ `state/shadowingPrefs`
  - 锚点的增删改（选字定块 / 微调 / 撕开的拆分 / 合并的并回）→ `state/anchorEditor`
  - 「撕 = 抵消合并、合并 = 撤销撕开」与 0.02s 容差 → `core/chunkEditLog`
  - 连续跟读那一轮（轮次号 / 录音定时器 / 说完收工 / 提前收尾）→ `state/cycleRunner`
  - 电平表节流（原始值判说话、节流值给 UI）→ `state/levelMeter`
  - 「说」记进学习统计（同一个 `reader:activity` 键 + 事件）→ `state/localActivity`
  `state/session` 只剩编排（状态机、播放/录音时序、竞态守卫），732 行；`ui/App` 只剩装配。
- **`calibrationRepo` / `scriptEditRepo` 仍走 localStorage**：一篇几个数字/几十 KB、接口是同步的；
  不是为了省事才不迁 SQLite——浏览器里上 SQLite 要 WASM 运行时，为这点数据不划算。
  真要迁，先改端口为异步，再走服务端 SQLite。
- **离线词典/例句加载器已搬到 `adapters/`**：`adapters/dictionary.ts`、`adapters/tatoeba.ts`；
  `core/dictionary.ts` 只保留纯断词判断（不碰 fetch）。

### 拆文件：拆**职责**，不是拆行数

超过 600 行先判断它是哪一种，再决定拆不拆：

| 它是什么 | 怎么办 |
| --- | --- |
| 一堆**状态机 / 优先级判断**藏在 JSX 里（九种状态靠三元链排先后） | **拆**。拆出来能单独测「哪个状态下出现哪个按钮」，顺序错了就是二次写库 |
| 只是把一个 hook 的结果**拍平**成另一个组件的 props | **别拆**。拆了就是搬运 props，两头都得改，还多一层文件 |
| 编排器，子逻辑已经在子 hook 里（`grading` / `spellingRound` / `timers` / `spellGate`） | **别硬拆**。两个共享十几个 setter 的 hook 比一个 695 行的编排器更难读 |
| 组合根（`ReaderApp`） | 只搬「成组的状态」出去（见 `useReaderPanels`），别为了行数把 `ReaderScreen` 的 props 改成嵌套对象 —— 那要让 4 个文件一起改 |

例子（2026-10-23）：`panels/StudyPanel` 的动作区（锤炼 / 学习释义页 / 判完等下一词 / 复习三态 /
忘了但刚选对 / 可评分 / 拼写待检查 / 等翻面）拆成 `panels/StudyActions`，配 9 条分支测试；
583 → 529 行。硬线仍是 800。

## 五、命令

```bash
npm run gates        # 收尾门禁：tsc + 全部测试 + 上帝文件 + 架构
npm run check:arch   # 只跑架构门禁（含存量豁免清单）
npm run check:size   # 只跑上帝文件门禁（含基线）
npm test             # vitest run
npm run test:watch   # 开发循环
```

门禁细节与「测试怎么写」见 `docs/TESTING.md`；工作流与收尾清单见 `AGENTS.md`。
