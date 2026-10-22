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
| 词条「类型」相关的判断与标签 | `src/core/entryKind.ts` | **SSOT**，视图不许再抄一份字面量（R5） |
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
| 服务端跑批（起跑 + 轮询） | `src/adapters/aiRun.ts` | 有界（40 分钟超时 / 连续 20 次失联）+ 可取消；hooks 里别自己 `fetch('/api/ai/run')` |
| 有状态的交互流程 | `src/reader/hooks/use*.ts` | 一个 hook 一件事；**同一份状态只允许一个写入方** |
| 全局键盘 | `src/reader/useHotkeys.ts` + `hotkeys.ts` | 只允许一个全局分发器，按优先级启用当前模式；禁止再直接 `window.addEventListener('keydown')` |
| 面板 / 列表 / 对话框 | `src/reader/panels/*.tsx` | 不准塞领域判断；判断回 core |
| 词库自动补全（例句/收藏…） | 加进 `src/core/libraryAutoFill.ts` | **不许再写第二个 effect 去读写词库**（见下） |
| 背单词的「加练 / 重练忘记的」出场次数 | `src/core/vocab/extra.ts` | 评「忘记了」就追加到队尾，**不封顶**，直到评「认识 / 模糊」；模糊即收尾、不再追加；「重练忘记的」每轮只发起一次。hook 只调 `planExtra` / `planRetryForgot`，不改评分 |
| 背单词计时（单卡 / 本轮总时长） | `src/reader/hooks/useStudyTimers.ts` | 归零只看换卡 / 换轮；`paused`（卡内编辑）只停表不归零，停表前把未落盘秒数补记 |
| 单词「学过没有 / 要不要复习」 | `src/core/vocab/review.ts` 的 `isFresh` / `hasReviewHistory` / `isRelearning` | 别再看 `repetitions === 0`：答错后它也会归零；新词 = 从未排期（interval 0 + due null + 非重学） |
| 拼写判错 → 判为「不认识」 | `src/core/vocab/spelling.ts`（`spellingMatches` / `markSpellingMiss`） | 一次判定：SRS again + `relearn + 1` + 「不认识」标签；会话负责重排与锁导航，视图不算规则 |
| 刚过释义关却点「忘记了」 | `src/core/vocab/review.ts` 的 `needsForgotConfirm` | 先确认再落库；确认前不写 SRS、评分快捷键停用；确认后仍按 again，**不偷偷降成 hard** |
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
- 「刚选对释义又点忘记」：`core/vocab/review.ts` 的 `needsForgotConfirm`。释义关 / 锤炼刚考过
  词义，紧接着评「忘记」是矛盾输入：先停在确认条（确实忘了 → again；其实记得 → hard），
  确认前不落库。**规则只决定「要不要问」，不替用户改分**；「不认识」按钮是显式标签动作，不走这条。
- 超时「强制锤炼」该不该出现：`core/vocab/drill.ts` 的 `shouldDrill`。锤炼是**评分门禁**
  （先做题才允许评分），所以「已经判完、停在卡上等下一词」（`parked`：学习判完 / 复习已判 /
  模糊待定）、学习模式四选项那一关、拼错判定页，一律不触发。
  踩过的坑：学习模式选错释义 → 判 again → 这个词立刻成了 `isRelearning`，
  点「继续（看单词卡）」的同一帧就命中「重学卡摊开释义 → 锤炼」分支，
  单词卡一帧都没露就被锤炼接管；复习模式按「忘记了」同样。**判完的卡不需要再门禁一次**。
  第二个坑（2026-10-22）：重学卡的「摊开过释义」一旦为真就一直为真，过完面板会**原地重开**，
  用户写完搭配也退不出去。所以「本卡本轮已锤炼完」由 `cleared` 统一兜，两条触发各自不用再记。

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

## 三·五、数据安全（事故之后立的规矩）

用户的词库是**唯一资产**，任何重构都不许让它的丢法变多。四条铁律：

1. **单写入口**：词库只由 `hooks/useVocabLibrary.persist` 写；增删动作统一走
   `hooks/useVocabEdits`（只经 `persist`，且以 `libraryRef` 为基准避免连续写互相覆盖）；
   自动补全只由 `core/libraryAutoFill` 这一个 effect 写。新需求加「自动补全」→ 往计划函数里加一格。
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
- **`ReaderApp.tsx` 已降到 732 行（出基线了，不再是大文件）；视图在 `ReaderScreen.tsx`（189 行）+ `screen/` 三个槽位**：
  它现在只做装配：状态声明、hook 接线、把结果拍平成 `ReaderScreen` 的 props。**两种"分叉"要警惕**：
  同一份数据两个写入方、同一套规则两处实现 —— 都拆到下面列出的 hook / core 里。外壳/正文/侧栏已抽到 `ReaderShell` / `ReaderArticle` / `panels/ReaderSidebar`；
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

## 五、命令

```bash
npm run gates        # 收尾门禁：tsc + 全部测试 + 上帝文件 + 架构
npm run check:arch   # 只跑架构门禁（含存量豁免清单）
npm run check:size   # 只跑上帝文件门禁（含基线）
npm test             # vitest run
npm run test:watch   # 开发循环
```

门禁细节与「测试怎么写」见 `docs/TESTING.md`；工作流与收尾清单见 `AGENTS.md`。
