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
| 路由 / 历史 / 深链接 | **纯函数单测 + 钩子测试（`MemoryRouter`）** | `reader/route.test.ts`、`hooks/useRoutedFlows.test.tsx`；用 `Link` 的组件测试包 `MemoryRouter` |
| 单个面板 / 列表 / 对话框 | 组件测试（环境已就绪；29 个面板全部有测试） | `reader/panels/*` |
| 浏览器能力（打印对话框 / TTS / 剪贴板 / IndexedDB 真库） | **人工用例**（§4） | 登记，不写自动化 |

**判定原则**：先问「这块判断能不能抽成纯函数」。能 → 抽出去写单测（最便宜、最稳）；
不能（纯排版/手势/浏览器 API）→ 组件测试或人工用例。**别用「跑起来点一下」当测试。**

## 二、需求完成门禁（Definition of Done，收尾逐条勾）

```
□ 先写/改测试，再写实现（TDD；至少：新规则一落地就有用例钉住）
□ 按 §1 矩阵补齐对应层；领域判断不在组件里
□ 新增 core 模块 → 同名 .test.ts（否则架构门禁 R7 失败）
□ 新增/修改整页界面 → 路由四件套齐全：可寻址、返回层级、深链失败回落、URL hook 测试
  （按 docs/ARCHITECTURE.md §三·八「新增整页界面 checklist」逐条做）
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
   规矩三条：**读成功才允许写**（`libraryLoad === 'ok'` 硬闸）；**覆盖前留快照**（保留最近 5 版 +
   历史最大的一版永不淘汰，「上一版」= 刚被覆盖的那一版）；**同一份事实存多处**（词库 / 文章 `Sentence.vocab` / 待选清单 /
   错题本 / 导出 JSON，任何一处被毁都能重建）。
   第四条（2026-10-23 补）：**整份覆盖要带版本号**。前端持有整份词库，保存就是全量 PUT；
   写回必须带 `X-Vocab-Base`（读到的那一版 `updatedAt`），服务端对不上回 409。
   测这件事要两头都测：`sqliteStore.saveVocab` 的版本校验（客户端 A/B 交叉写），
   以及 `HybridVocabRepo` 的接线（带对 header、409 时不降级到 IndexedDB、不镜像本地）。
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
17. **本篇生词别再用「正文 ∩ 词库」算**。那会把总词库里恰好出现的 the / is / are
    自动算进新文章、带编号，用户根本没在这篇标过。规矩：本篇只认 `library.articleEntries`
    （SSOT 在 `core/articleVocab.ts`）；编号走 `core/articleNums.ts`，语境释义走
    `core/articleMeaning.ts`。语言点也收进按篇条目，但只有普通单词参与正文编号。
18. **替换旧资产要先写新的、再删旧的**。录音曾先 `repo.remove(旧 take)` 再 `repo.save(新 take)`；
    IndexedDB 配额满时新录音没存进去、旧的已删，这一块两条都没了。规矩：先保存成功，再清理旧版本；
    失败时写 `SessionState.error` 等可见提示，且 `stopRecording()` 自己不 reject（调用方多是 `void`）。
19. **元素级脏数据要逐条丢，不能整批吞**。`JSON.parse` 成功 ≠ 数据可用：活动数组里一个 `null` /
   `{day: 5}` 就能让 `addActivity` 抛异常，外层 catch 把今天这笔正常记录也一起丢了；AI 跑批的
   `results` 里一个缺 `raw` 的元素会让整批作废。规矩：跨边界先过 `normalizeActivity` /
   `normalizeAiResults` 这类守卫，返回「好数据 + 丢弃数」；`localStorage.getItem` 本身也要走
   `reader/storage.ts` 的 `readRaw`（隐私模式下 getItem 会抛）。
20. **语言点旧键会「占住」同名单词**。早期 usage 笔记拿笔记里的英文词当 lemma（如 `mantra`），
   于是同名单词被当成「用法」、手动加词永远合并进去。规矩：`repairLanguageKinds` 先把旧笔记的
   lemma/id 改成整条文本键（并按句重映射 `articleEntries`），**再去重**；顺序反了会在去重时把
   「笔记 + 单词」合并掉。迁移测试要同时断言「笔记改名」和「同名单词能新建」。
21. **批量动作不能各自拿渲染时的旧词库连跑**。一键「挑词 / 补齐 / 例句 / 校正 / 混淆」如果同时调用
   各按钮的回调，后一个 `persist` 会覆盖前一个（闭包里还是旧 `library`）。规矩：每步读
   `libraryRef.current`，上一步 persist 后同步更新；例句放在校正原形之前（否则旧词形对不上）；
   按钮用 `busy` 防重入。测试用可更新的假 ref + persist，断言调用顺序和最终库不丢步骤。
22. **待选词提交必须带来源，不能默认成「手动」**。`commitBatch` 过去只传 `origin`，AI 自动标词 /
   离线词典挑词整批提交后全变「手动」，用户以为自己点过。规矩：`BatchItem.via` 从产生处一路带到
   `markWord`（手动点选 `manual`、词典 `dict`、AI `ai`、听写 `auto`）；旧待选没有 `via` 时提交记
   `batch`。**不要按加入时间反推来源**：旧条目没有 `via` 就显示「旧数据」，不猜是 AI / 词典 / 手动。
   来源合法值只在 `core/vocabVia.ts`（`isVocabVia`），localStorage 读回先过守卫。
23. **易混项来源也要在写入边界标**。`VocabItem.confusables` 有两个写入方：AI 混淆项任务
    （`core/aiApply.ts`）和离线词典（`useDictTools.confuseFromDict`），过去没有来源字段，
    界面分不出。规矩：`applyConfusables` 必须显式传 `'ai' | 'dict'`；旧数据没有
    `confusablesSource` 就不显示来源，不按内容/时间猜。合法值与标签只在
    `core/vocabConfusables.ts`（`isVocabConfusableSource`），备份 / localStorage 读回先过守卫。
24. **词条核心字段要逐字段记来源，不要一条 `status` 管全部**。音标 / 词性 / 中文释义 / 英英释义
    可能来自 AI、离线词典或手动；过去 `status === 'edited'` 会把整条锁死，AI 补不了没动过的字段。
    规矩：写入边界给 `fieldSources[字段]`（`ai` / `dict` / `manual`）；`editItem` 只给实际改过的字段标
    `manual`；AI 覆盖判断统一走 `isFieldLocked`，旧数据没有 `fieldSources` 时保持整条锁。
    词典只填空，因此只跳过 `fieldSources[字段] === 'manual'`（用户手动清空的不再补）。
    备份 / localStorage 的 `fieldSources` 先过 `core/vocabFields.ts` 的清洗。
25. **「暂停」别和「归零」挤在同一个计时 effect 里**。加暂停时顺手把 `paused` 塞进 deps，
    一开卡内编辑 effect 就重跑、顺手 `setCardSeconds(0)`：计时归零、锤炼阈值跟着倒退，
    保存后从 0 重新「烫」。规矩：`useStudyTimers` 里拆成两个 effect ——
    **换卡 / 换轮才归零**（deps 不含 `paused`），**跑表看 `paused`**；暂停前先把未落盘秒数补记，
    暂停期间不推进锤炼阈值、不计学习时长。测试钉住「暂停 10 秒计时不变、恢复后接着走」。
26. **「忘记」不再封顶：练到用户自己说认识 / 模糊为止**（2026-10-21 改版）。
    旧规则「每卡每轮最多 3 次」会在第 3 次之后把一直记不住的词放过，等于替用户决定「可以了」。
    规矩：`planExtra` 只对「忘记了」追加到队尾，**不限次数**；「认识 / 模糊」都是收尾，不再追加
    （模糊本身就是「有印象但没把握」的终点）。代价是用户一直点忘记时这一轮做不完——停不停由用户
    决定（切下一个 / 结束），程序不替他跳过；复习侧靠 `again → relearn` 把它排进下次复习队列最前。
    别再引入「到上限就跳过」的逻辑；要改先改 `core/vocab/extra` 与那组测试。
27. **`repetitions === 0` 不等于「新词」**。评「忘记」/ 拼错都会把它归零；如果队列还按它筛，
    「记住过又忘」的词会从复习队列消失（`buildReviewQueue` 过去要求 `repetitions > 0`），
    还会重新占每日新词配额。规矩：新词只看 `isFresh`（reps 0 + interval 0 + due null + 非重学），
    学过与否看 `hasReviewHistory`，重学看 `ReviewState.relearn`。答错后走复习队列最前，
    不再走「新学习」。
28. **拼写题不能用词形还原兜底，判错也不能给第二次输入**。过去 `isCorrect` 对 `ran` / `run`
    做 lemma 兜底，拼写题里「ran」被判对，于是「拼错 → 不认识」永远触发不了；
    锤炼里的拼写还会留着输入框让人反复试，等于把考试变成抄写。规矩：
    `STRICT_SPELLING`（spell / ear / define）只认拼写本身；拼错只判一次，由
    `markSpellingMiss` 写 again + `relearn` + 「不认识」，会话把词重排并**锁住下一题 / 退出**，
    确认后才继续；重学卡先看词、再揭示、再强制锤炼，不直接进拼写题。
    不要用组件本地 state 判对错（`spellingMatches` 是唯一口径）。
29. **「刚选对释义」和「忘记了」不能同时无摩擦成立**。释义关 / 锤炼刚考过词义，用户紧接着
    点「忘记了」，过去会直接按 again 把 `repetitions` 打回 0；如果这词本来就标着不认识，
    下一轮又先考释义、又点忘记，进度能一直清零。规矩：`needsForgotConfirm` 为真时先停在确认条，
    **确认前不写 SRS、评分快捷键与导航都不生效**；确认「确实忘了」仍按 again（不篡改评分），
    「其实记得」按 hard 落库。别把这条做成「静默降级」——用户没选过的分数不能替他改。
    注意 `markUnknown`（「不认识」标签）是另一条显式动作，不并入这个确认。
30. **`<p>` 里塞 `<div>` 会让 React 刷屏，而且跨组件才看得出来**（2026-10-23）。
    语言点由 `LanguageLines` / `LangPhrases` 渲染，当时用的是 `<div className="lang-line">`，
    而它被挂在正文段落的 `<p className="para">` 下面 —— 单看任何一个文件都合法，
    合起来就是非法嵌套，console 里一串
    `validateDOMNesting(...): <div> cannot appear as a descendant of <p>`；
    真机上浏览器还会按容错规则**提前闭合 `<p>`**，把后面的结构挪位。
    规矩：会进 `<p>` 的组件一律用 `<span>` + CSS 拿回块级外观（`.lang-line` 的 `display:block` 就是这么来的）。
    两道闸：门禁 **R8**（`tool/check_architecture.mjs`，跨组件静态扫「`<p>` 里引用的组件渲染树有没有块级标签」）
    + `src/reader/panels/domNesting.test.tsx`（直接量渲染后的 DOM，不依赖 React 的 dev 警告）。
    **别用 `console.error` 断言 `validateDOMNesting`**：那条警告按 (childTag, ancestorTag) 全局去重，
    同文件里前面用例触发过，后面就永远绿。
31. **降级链的 bug 会把主路径一起带崩**（2026-10-23）。阅读页点任意一句，`/api/tts` 全 502：
    `tts failed: listPiperVoices is not defined`。而 Edge TTS 本身是好的（单独探针 1.9 秒出 14KB）。
    原因在 `tts-core.mjs` 的 `synthWithFallbacks`：兜底候选写在循环头里
    `for (const attempt of [target, ...fallbackTargets(target)])` —— 数组在**尝试 Edge 之前**就展开，
    于是兜底代码里一个笔误（`listLocalVoices` 写成没导入的 `listPiperVoices`）每次都先抛
    ReferenceError，主路径根本没机会跑；错误还被外层 catch 成 502，看起来像「TTS 服务挂了」。
    规矩：**兜底候选等主目标真的失败之后再解析**，且解析失败只丢兜底（`console.warn` 出来），
    不许影响主路径。`tools/tts-core.test.mjs` 已钉住 `localFallbackTargets` 不抛异常 + 候选形状合法。
    排查口径：TTS 502 先看响应正文里的 `tts failed: ...`，那是真实异常消息，别只看状态码。

## 四、人工用例（自动化覆盖不到的，登记在此）

| 场景 | 步骤 | 通过标准 |
|---|---|---|
| A4 打印 | 侧栏「🖨 打印 / 导出…」→ 选内容/范围/分组 → A4 打印 | 新窗口版式正确（3 栏、词组带类型小标）、打印后条目变「已打印」 |
| 离线词库/例句 | 装好 `public/ecdict.tsv` / `tatoeba-en.tsv` 后刷新 | 生词卡自动有音标/释义/离线例句；控制台无报错 |
| 离线词典一键处理 | 侧栏「选词·分析」→ 📖 离线词典 → ⚡ 一键处理 | 依次完成挑词 / 补齐 / 例句 / 校正 / 混淆；处理中按钮禁用；最终词库保留全部步骤结果，不互相覆盖 |
| 速读悬浮释义 | 速读里悬浮已收录的词 | 显示释义；未开「选词模式」时点词有提示（不是静默） |
| 语言点自动收藏 | 跑一次「语言点」AI 任务并粘回 → 刷新 | 侧栏「语言点」页签出现词组/习语/用法；删掉一条后刷新**不会**自己回来 |
| IndexedDB 持久化 | 加几个生词 → 刷新 → 换文章再回来 | 词库在；来源文章/句子正确 |
| 离线 TTS（Piper） | Linux：跑 `./tools/install-piper.sh`；Windows：`piper.exe` 放 `%LOCALAPPDATA%\piper\`、模型放 `%LOCALAPPDATA%\piper\voices\`（或 `PIPER_BIN` / `PIPER_VOICES_DIR` 指定）→ 重启服务 → 刷新 → 音色选「离线 · 本地语音」里的 Piper → 读本句。装完先看 `GET /api/tts/engines` 的 `local.reason` 是不是 `ok` | 有声、不联网、明显比系统机器人音自然；无逐词高亮可接受（点词会退化为「截取该词到句尾」播放，不整句重来）；切回 Edge 后恢复 |
| Piper 失败 → 浏览器语音 | 临时把模型目录改空（`PIPER_VOICES_DIR=/tmp/empty` 重启）→ 手动选 Piper 音色 → 读本句 | 退回浏览器语音，不报 502 |
| TTS 自动兜底 | 让 Edge 不可用（断网 / 代理坏）→ 读本句 | 仍出声（先 Piper，再浏览器语音）；约 20 秒后自动回头重试 Edge |
| Chromium 浏览器语音兜底 | 装 `speech-dispatcher` 后重启 Chromium → 停服务 → 读本句 | 浏览器语音有声；控制台无 `speechSynthesis` 报错 |
| SQLite 主存 / 迁移 | 先在有旧 IndexedDB 数据的浏览器打开新版 → 刷新 → 查 `data/xueba.db` | 词库/文章迁到 SQLite；刷新后仍是同一份；停服务后页面仍能读 IndexedDB 兜底 |
| SQLite 导出 | 浏览器打开 `http://localhost:5173/api/store/db` 或 `/api/store/export?download=1` | 下载 `.db` / JSON；`sqlite3 data/xueba.db '.tables'` 能看到 `vocab`、`articles`、`words`、`article_sentences`、`lang_points`、`learning_snapshots` |
| 完整 JSON 备份 | 侧栏「导出全部（备份）」→ 清空 localStorage 或换浏览器 → 「导入备份」 | 复述、每天背过的词、略读标记、按篇/题型统计也恢复；同一份备份「合并导入」两次：第二次按文件指纹直接跳过并提示（不同备份仍按天累加学习时长/活动） |
| 每篇生词独立 | 词库里先有几篇生词 → 新建/打开一篇没标过词的文章 | 侧栏「生词本 · 本篇」为空、正文没有编号/高亮；总词库里有的 the / is / are 不自动进来 |
| 按篇编号 / 删除 | 同一篇依次加 3 个词→删中间一个→重新打开 | 编号按加入顺序 1..n，删除后紧凑重排；删词只从本篇消失，全库/别的篇仍保留 |
| 按篇打印 | 两个不同篇都收同一个词 → 分别 A4（本篇） | 各自打印自己的清单与编号；打印后只影响当前篇的「已打印」状态 |
| 录音配额满 | 用 DevTools 把站点存储配额限制到很小 → 录一条 | 出现「录音保存失败…旧录音已保留」；上一块旧 take 仍能回放；控制台无 unhandled rejection |
| 开麦瞬间中止 | 连续跟读点空格后，在麦克风授权/开麦返回前再按一次空格 | 最终不录音、不生成 take，麦克风指示关闭；再按空格能正常开新一轮 |
| 新词配额跨结算点 | 把系统时间调到 03:59，打开阅读页并加入新词 → 等到 04:00（或调时间触发） | `newToday` 当场归零；刷新后仍是新学习日的 0 |
| 学习记录快照 / 恢复 | 先做几次答题/背词 → `GET /api/store/learning/snapshots` 取一个 id → 执行若干改动 → `POST /api/store/learning/snapshots/<id>/restore` | 恢复后练习/错题/背词记录回到快照时点；恢复前当前状态也进了快照，列表多一条 |
| 写入失败自动补写 | 停掉后端服务 → 答几题（localStorage 有记录）→ 重新启动服务，**不刷新页面** → 等约 5–10 秒 → 查 SQLite | `data/xueba.db` 的 `practice_records` 等表补上新记录；`localStorage` 的 `reader:learningDirty` 被清掉 |
| 文章上一版 / 恢复 | 改一篇文章正文并保存 → 再改一次 → `GET /api/store/articles/<id>/prev` → `POST /api/store/articles/<id>/restore-prev` | 恢复后回到上一版；再调一次 restore 能切回恢复前那一版（prev 会保留当前版） |
| schema 迁移备份 | 用旧版本创建的 `data/xueba.db` 启动新版 | 启动日志有「迁移前备份」；`data/backups/xueba-v<旧版本>-*.db` 存在，保留最近 5 份；同次启动还会生成当天 `xueba-daily-*.db`（保留 7 天） |
| 备份损坏自愈 | 停服务 → 把当天 `data/backups/xueba-daily-*.db` 覆盖成任意文本 → 重启 | 日志出现「当天备份校验失败，重新生成」；备份文件恢复为可 `quick_check` 的正常库 |
| 速读 · 语言点输入框 | 非护眼深色主题 → 速读 → `＋ 语言点` → 在「结构 / 语法」里输入 | 输入文字与光标清晰可读（深底浅字）；切护眼主题后为白底深字 |
| 学习记录「重建并核对」 | 侧栏「统计」→ 底部「重建并核对」 | 服务在跑：提示「核对一致」或列出差异项（只读，不改本地）；服务没起：提示重建失败，页面数据不变 |
| 旧地址兼容 | 浏览器打开 `/reader.html#/a/<slug>`（收藏夹里的老链接） | 地址栏 `replaceState` 成 `/reader/a/<slug>`，文章正常打开；普通路径不被改写 |
| dev SPA 回落 | dev server 跑着时：`curl -s -o /dev/null -w '%{http_code} %{content_type}' http://localhost:5173/reader`；再试 `/reader/a/x`、`/assets/nope.js`、`/reader/missing.js` | `/reader` 与 `/reader/a/x` 返回 `200 text/html`；两个带扩展名的缺失资源返回 `404`（不能回落成 HTML） |

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
`useLearningData` 的复述 / 略读动作（空白与无文章不记、按时间删、来回切）、
`useMistakeActions`（三类错题重练 + 包围战：空错题提示、按类型过滤、40 词上限）、
`useVocabMode`（选词模式：计时、切走暂停、关闭记会话、卸载清计时器；假计时器）、
`useArticleDerived`（本篇归属 / 略读 / 掌握度 / 工作流 / 产出看板：只算当前文章）、
`useReaderViewData`（就绪清单 / 学习日志 / 打印 lemma 索引 / 文章测验数）、
`useArticleWorkspace`（文档动作组装 / 新建导入态 / 语言点编辑写回）、
`useSessionServices`（会话转发 / 启动互斥 / 错题重练 / 选词计时）、
`useAiServices`（AI 待办推导 / 工作包 / 粘回路由）、
`useArticleUiActions`（Alt 复制 / 两步删除 / 逐词高亮 / 点句朗读 / 离线例句）、
`useSelection`（点句 toggle / A-D 循环 / 待选去重计数 / mark 走唯一写入口 / 来源定位回填）、
`useAiPack` 的跑批轮询（error 立即停 / 失联 30s 判错 / 取消打断 / 卸载清定时器；假计时器）、
`useToast`（自动消失 / 连续 flash 不被旧 timer 清掉 / 卸载清定时器）、
`useLearningRebuild`（重建一致 / 差异只报不改 / 服务不可用 / 仓储没实现 / 异常后可重试 / 连点只发一次）。
TTS 逐词时间对齐在 `core/ttsTiming`（归一化对齐 / 缺词兜底 / 多余忽略），服务端时间戳/预热请求在
`adapters/ttsCache`（URL 编码 / 非 2xx / 空数组 / 坏 JSON 一律降级为不高亮），连字符词典在 `core/dictionary`。
视图层 `ReaderScreen` 只留外壳，三个槽位在 `screen/*Zone`（纯映射，不单测；由 `ReaderApp.integration.test.tsx` 覆盖条件渲染）。
组件宿主：`ReaderSidebarHost`（10 条）、`ReaderToolbarHost`（6 条）、`ReaderOverlaysHost`（6 条：开关路由 / props 转发 / 全部生词工具栏）。
列表无障碍：`VocabList`（7 条：卡片/表格视图的动作按钮都带词条名、两步删除换标签、回调不变）、
`LangPointList`（改/删带条目名）、`SpeedReadBasket`（移出带词）、`ReaderShell`（toast 的 `role=status` + `aria-live`）。

组件/钩子测试的三个坑（都踩过了，照着做）：
1. 默认环境是 `node`（快）；要测 React 就在**文件第一行**写 `// @vitest-environment jsdom`。
2. jsdom 的 `localStorage` **取不到**（不透明来源会被 vitest 跳过），Node 26 又自带一个**只读**的全局
   `localStorage`，直接赋值会静默失败 —— 一律用 `src/reader/testStorage.ts` 的 `installFakeStorage()`
   （defineProperty 覆盖 + 测完还原）。
3. 钩子/面板依赖 IO 时**注入假实现**（`persist` / `libraryRef` / `onPrint` 这类回调），别真的开 IndexedDB、
   别真的调 TTS/打印。

**还差**（2026-10-20 盘点）：
- **hooks 55 / 55 有测试**：本轮补齐 `useDictionary` / `useTtsEngines` / `useDocVocabSets` / `useDictTools` /
  `useArticleImport` / `useReaderDoc` / `useListening` / `useWriting` / `useQuickSession` / `useSelection`；
  `useSpeaking` 拆成「播放」`useTtsPlayback`（5 条）+「预热」`useTtsPrefetch`（5 条），facade 原有 8 条接线测试不动；
  速读的选词/入库/本页清单抽到 `useSpeedReadWords`（8 条）、会话状态机抽到 `useSpeedReadSession`（12 条），
  面板 `SpeedReadPanel` 只留渲染（597 → 260 行）。
  背单词拆成 `useStudyPool`（设置/候选池，3 条）+ `useStudyTimers`（计时/落盘/暂停停表/暂停补记，5 条）+
  `useStudyCardEdit`（卡内编辑/两步删除，3 条）；`StudyPanel` 再拆 `StudyToolbar` / `StudyEditForm` / `StudyRoundDone`
  （512 → 369 行，子组件 3 + 2 + 2 条）。
  加练上限与编辑暂停计时落在 `core/vocab/extra`（9：每卡 3 次 / 模糊只一次 / 过门禁不追加 / 重练只一次 / 循环收敛）
  + `useStudySession`（9：导航 / 门禁 / 牌组 / 朗读 / 加练 3 次封顶 / 重练跨轮计数 / 编辑暂停 10 秒不动表），
  `StudyRoundDone` 钉住「重练过就不再给按钮」。
- **阅读页装配层（`ReaderApp`）拆完也全有测试**：`useReaderPrefs`（8：18 个本机偏好默认值 / 写回原键 / 脏值兜底 /
  `newToday` 跨天归零 / 页面开着跨 04:00 定时归零）、`useArticleVocabView`（10：本篇生词两条口径 / 编号 / 打印口径 / 空文章不炸）、
  `useIntensiveActions`（6：阶段→工具、拷打→题型两张表，语法走文章级）、`useModifierKeys`（5：Ctrl/Meta/Alt 按下松开 + 失焦清）、
  `useStorageQuotaToast`（4：提示一次 / 5 秒节流 / 卸载不提示）、`useQueueAutoSpeak`（7：听力题与听写逐句，越界不念）。
- **tools 脚本有同名测试（2026-10-24）**：`ai-core`（跑批 / 取消 / HTTP 起跑）、`spa-route`（dev 回落）、
  `ai-pack`（工作包解析）、`ai-agent`（结果抠 JSON / 路径 / Windows 引号）、`tts-core`（降级链）。
  薄包装 `vite-*-endpoint` 与 `build-*.mjs` 数据脚本仍靠手测。
- **阅读页滚动进度与速读游标（2026-10-20 第三批）**：`core/scrollProgress`（12：比例夹取 / 脏值回顶部 /
  像素↔比例 / 可滚区间为 0 不算 NaN）、`state/scrollPrefs`（10：内存优先于 localStorage / 按文章分开 /
  重开后回落硬存 / 空 docKey 不建键 / 写失败不抛）、`hooks/useReadingScroll`（9：恢复到位 / trailing 节流只写最后一笔 /
  滚回顶部也记 / 卸载与换篇会结清）。正文签名单独立成 `core/docSignature`（5 条：同正文同签名 / 不同正文不撞 / `ab|c ≠ a|bc` / 空正文稳定），
  速读那边 `core/speedRead` 的 `speedCursorKey` 补 2 条（标识相同、正文不同 → 键不同），`useSpeedReadSession` 补 5 条
  （停在最后一句退出清零 / 读完退出清零 / 读到中间退出保留 / 同标识换正文从第一句开始且成绩清空 / 换回原篇回原位）。
  这条 hook 用「假滚动元素」测：jsdom 不做布局，`scrollHeight` 恒为 0，会被「可滚区间 0」的守卫挡掉。
- **背单词「学习新词」四选项（2026-10-22 第一批）**：`core/vocab/learnStep`（13：看答案 / 选错 = again /
  首次选对 = hard / 第二次起 = good / 词库不足 fallback / 停留常量 > 0 / 次数脏值按 0 /
  判不认识归零 / 写库只改一条且 0 时摘字段 / 次数没变不白写 / 找不到词原样返回）、
  `core/vocab/meaningOptions`（6：4 条且只有一个正确 / 干扰项不含正确释义 / 顺序稳定 /
  正确项下标 / 词库不足返回空 + -1 / 无释义不出题）、`useStudySession` 补 5 条
  （看答案判不认识且不自动跳 / 选对记次数并进单词卡 / 选错停住等「继续」/ 判完空格 = 下一词不二次评分 /
  词库不足不出题）、`hooks/useStudyLearnStep`（8：学习模式新词才出关 / 复习模式与重学词不抢 /
  词库不足或没在背不出题 / 看答案停留可打断（fake timers）/ 选对直接进卡 / 选错等「继续」/
  判过不再重复判定 / reset 清定时器）。
  **改了一条旧用例**：原「复习门禁」用的是新词，现在新词在学习模式走四选项，
  门禁用例改用「学过但排期后又忘」（有 due、repetitions 0）的词 + `mode: 'review'`。
  **拆了 hook**：`useStudySession` 到 800 行上限被门禁拦住，学习模式这一关的状态机
  拆到 `hooks/useStudyLearnStep`（落库仍回调主 hook 的 `applyGrade`，避免两个写入方）。
- **背单词「组末拼写测试」（2026-10-22 第二批）**：`core/vocab/review` 补 4 条（`groupEndOf`：size≤0 不分组 /
  小数 floor / 越界封顶 total / 普通切组）、`hooks/useStudySpellingRound`（6：begin 建序列 /
  逐词拼对推进 + 全拼完 onDone 一次 / 大小写空格不算错 / 拼错 onMiss 一次并显示原文 /
  重打再错不改判定、照原文打对才放行 / begin 与 reset 清状态）、
  `useStudySession` 的旧「E 到完成页」用例改为「组末先拼写，拼完才进完成页」。
  **拆了 hook**：正面拼错的卡面拆到 `useStudySpellGate`、组末序列拆到 `useStudySpellingRound`
  （落库都经回调回主 hook，一个写入方）；锤炼板拼错与正面拼写共用同一条判定路径（归一化一致）。
  **踩坑**：`advance` 曾在 `setIndex` 的 updater 里嵌套 `setWords` + `onDone`（→ 主 hook 再 `setIndex`），
  React 渲染期嵌套更新在 jsdom 下只报一个被 sourcemap 吞掉的神秘错误（`column must be >= 0`）——
  **updater 必须纯**：先用当前值算好下一步，再分头更新，最后才回调。
- **背单词「锤炼门禁 + 两列布局」（2026-10-22 第四批）**：`core/vocab/drill`（5：没在背 / 拼错判定 /
  释义关不锤炼、超时触发、重学卡摊开释义触发、已判停卡两者都不抢）、
  `hooks/useStudySession.drill.test`（3：学习选错释义 → 点「继续」要见到单词卡 / 复习判「忘记了」停卡看答案 /
  下一条重学卡摊开释义才锤炼）、`StudyPanel` 补 2 条（工具条只能在自己的左栏、拼错页空格提示）。
  **踩坑 1**：锤炼是**评分门禁**，判完停在卡上的卡不能再门禁一次——学习模式选错释义判 again 后，
  这个词当场成了 `isRelearning`，点「继续（看单词卡）」的同一帧就命中「重学摊释义 → 锤炼」分支，
  单词卡一帧都没露；复习模式按「忘记了」同样。
  **踩坑 2**：grid 行高默认 `auto` 会被内容撑开，`flex: 1 / min-height: 0` 全白写，
  按钮照样被顶出屏幕；要显式 `grid-template-rows: minmax(0, 1fr)` 才锁得住一屏。
  **踩坑 3**：夹具 `Harness` 的 library 是静态的，判完 again 不会真的变成 `isRelearning`——
  要测这条路径得用回灌版（`onPersist` → `setLibrary`，见 `useStudySession.drill.test` 里的 `Live`）。
  **踩坑 4**：`R`（朗读）原来写在最后那条「普通卡」分支里，前面 5 个状态分支全是 `return`——
  学习模式判完停在 `learnGraded`（几乎是常态）时按 R 毫无反应。**全局动作要放在状态分支之前**，
  只保留「拼写未判卷（防剧透）」「光标在输入框里」两个例外；补了 2 条用例（判完停卡能读 / 释义题能读且拼写判卷前不读）。
- **背单词「复习三键 + 快捷键」（2026-10-22 第三批）**：`core/vocab/reviewStep`（7：认识/easy 直接推进 /
  模糊不落库只摊卡 / 忘记立刻 again 停卡 / 模糊两个出口 / 一次只写一次库）、
  `hooks/useStudyReviewStep`（10：复习模式才给三键 / 学习模式与门禁占住时不给 /
  认识推进 / 模糊摊卡 / 忘记停卡 / 模糊→下一词=hard / 模糊→记错了=again / 判过不重复写库 /
  模糊待定时不叠判定 / reset 复原）、`hooks/useStudyStarts`（6：新学习只取新词 / 复习只取到期 /
  空队列给提示 / 本篇全部忽略配额 / 从头重学标 retrying / 拼错未确认不许重开 + 空牌组只提示）、
  `useStudySession` 补 9 条（复习三键落库与推进 / 复习模式也有组末拼写 / 空格只是看一眼释义 /
  H=看答案且与 A/D 不冲突 / U=不认识 / M=记错了）、`StudyPanel` 补 4 条（三键不用翻面 /
  点卡不偷看 / 模糊两个出口 / 判完只等下一词且不给「不认识」二次写库）。
  **拆了两个模块**：键盘映射搬到 `hooks/useStudyHotkeys`（`useStudySession` 一度涨到 831 行）、
  「背哪些词」搬到 `hooks/useStudyStarts`。
  **踩坑**：复习模式判完停卡时，「下一词」必须走 `choose('next')`（写 hard + 推进），
  不能走 `forward()`——后者只切卡不落库，模糊那一次就悄悄丢了。
- **词形只做屈折还原，派生词不改名（2026-10-22 词性/释义错位批）**：`vocab/word` 补 4 条
  （`canRewriteTo`：屈折放行 / 否定前缀派生不放行 / 其它派生后缀不放行 / 短语与空串不放行）、
  `vocab/analysis` 补 5 条（`applyPosAnalysis` 遇到 `unchallenged → challenge` 只记笔记不改名 /
  真屈折照旧改名 / 释义被换掉时词性跟着换 / 释义变了但 AI 没给词性就清掉旧的 / 释义没变只补空）、
  `aiApply` 补 1 条（原形校正拒绝派生词并在回执里点名）、`dictEnrich` 补 1 条（已有释义时不补词性）、
  `ecdict` 补 4 条（`glossForPos` 按词性挑释义行）。
  **为什么**：`-ing/-ed 辨析` 拿 AI 给的「原形」直接改词条 `word`，而 AI 把加前缀造出来的**另一个词**
  当词形变化（`unchallenged → challenge`）——改名不动释义，于是 `challenge` 卡上挂着
  `a. 未引起争论的`（用户 2026-10-22 报的四个词就是这样）。同一批还修了「词性来自词典首义、
  释义来自 AI 语境义」的错配（`consort` 卡上的「n. 交往；厮混」）：释义换来源时词性必须跟着换，
  词典也只在同批补释义时才补词性。存量脏数据用 `tool/audit-vocab.mjs` 体检 + `--fix` 回改
  （证据是 `note` 里的 `[辨析] <原词形>`，以及英英以 `to …` 开头却标成名/形的词条）。
- **词典词性只是占位，AI 看过语境就归 AI（2026-10-22 rival 案例）**：`vocab/analysis` 补 2 条
  （`fieldSources.partOfSpeech === 'dict'` 时，AI 重查给的词性即使**释义一字未变**也要覆盖
  `/ 手动改过的词性不被 AI 覆盖`），`analyzerPrompt` 补 1 条（查词提示词里写着「词性按上下文用法定」
  与「五样同属一个义项」）。**为什么**：`rival` 的义项早就是「与……匹敌」，但词典占位的 `n.`
  一直压着语境里的 `v.`——旧逻辑只在「释义变了」时才让词性跟换，重查多少次都改不回来。
- **义项一致性不能只靠各写入方自觉（2026-10-22 rival/term 案例）**：新增 `core/vocab/sense`
  补 9 条（`posClassOf` 认缩写/全称/并写、`posFromGloss` 认「n. 誓约」这类首标、
  `reconcileSense` 让词性跟释义首标走且不动 manual、`senseConflict` 认出两类矛盾）、
  `useApplyTaskResult.sense` 补 3 条（AI 给释义不给词性 → 词性留空 / AI 给词性就用 AI 的 /
  AI 没给释义时词性取词典同一行的标记），`analyzerPrompt` 补 1 条（提示词写明「五样同属一个义项」）。
  **为什么**：`term` 卡上是 `n. 把……称为……`、`rival` 卡上是 `n. 与……匹敌`——词性来自词典词头首义，
  释义来自 AI 的语境义，两个义项被拼在一张卡上。之前只在「释义变了」时才让词性跟换，
  所以重查多少次都改不回来。现在由 `tool/check_vocab_sense.mjs` 在 `npm run gates` 里守着。
- **卡内编辑只提交改过的字段（2026-10-22）**：`useStudyCardEdit` 补 2 条（只改释义时词性
  `fieldSources` 仍是 `dict` / 一个字没改不写库）。`editItem` 会把手上的每个字段都标成 `manual`，
  全都传一遍＝「点一次保存、整条卡锁死」，之后词典/AI 再也纠不了它（`dwarf` 卡的
  「n. 使相形见绌」就是这么冻住的）。
- **锤炼做完就退出去（2026-10-22）**：`vocab/drill` 补 1 条（`cleared: true` 时即便重学卡摊着释义也不拦）、
  `useStudySession.drill` 补 1 条端到端（重学卡摊释义 → `drillOn` 为真 → `clearDrill()` → 变假）、
  `StudyDrill` 补 2 条（最后一步「写搭配」答对只回调一次 `onDone` / 写错留在本步给参考）。
  **坑**：重学卡的 `relearnRevealed` 一旦摊开就一直为真，审完面板会原地重开——用户写完搭配
  正确也退不出去。超时那条有 `!drillCleared` 兜着，只有重学这条没有，所以「过没过」改由
  `shouldDrill` 的 `cleared` 统一兜。
- **判分的账本单独一个 hook（2026-10-22 优化批）**：`hooks/useStudyGrading`（8：评「忘记」写库 + 计数 + 计时 +
  记活动 + 进忘记账本 + 排到队尾 / 新词「今天已引入」只记一次 / 评「认识」不动忘记账本且不重排 /
  `resetLedger` 归零 / 拼错判 again 并返回「已排到队尾」/ 组末拼错只记账不重排 /
  标「不认识」打标签但不本轮重排 / 空账本也能 reset）。
  **为什么拆**：同一套账（写库 → 今日新词 → 计时 → 计数 → 重排 → 提示）原来在拼写判错、评分、
  标「不认识」、组末验收四处各写一遍，漏改一处就会静默不一致（比如今天的额度少扣一次）。
  `useStudySession` 769 → 699 行，仍是门禁阈值（800）内；剩下的是 9 个子 hook 的接线与 70 个返回字段。
- **跑批「点了没反应」与闭卷先学（2026-10-23）**：
  `core/aiTodos` 补 2 条（没有释义的都要补、只差音标的才看 `status`；例句/词组/语法标记按 30 分块）、
  `core/aiPackage` 补 1 条（35 个缺口 → 2 条任务，`countAiJobs` 与 `buildJobs` 数量一致）、
  `core/aiApply` 补 2 条（回执数**实际写入**的词条数；一行都对不上时 `next: null` 且点名）、
  `core/intensive` 补 1 条（词块进度按 `chunksAsked` 算，真没搭配的词不卡死阶段）、
  `core/output` 补 1 条（没批改的仿写不再按 70 分兜底）、
  `useQuizSession` 补 4 条（预习卡 → 开始才开考 / 取消 / 不传 warmup 直接考 / 卡片按题型给词块）、
  新增 `panels/DrillWarmup`（4：词块档给 chunks、记忆档给例句、两个按钮、空卡有说明）。
  **坑**：`pickExamples` 原来 `.slice(0, 30)`，缺口 90 个就变成「点十次还在补同一批」；
  回执原来拿 `rows.length` 当写入数，词形对不上也报「已加入 30 个词的例句」——回执必须数
  **引用变了的词条**，这一条以后照抄。
- **顶栏行数（2026-10-20 第五批）**：`core/toolbarRows`（8：默认 4 行 / 脏值回 4 / 字符串与数字都认 /
  每档行数等于档位 / 四组不丢不重不乱序 / 3、2 档的具体并法 / 统计组恒在最后一行 / 类名拼法）、
  `useReaderPrefs` 补 1 条（默认 4 行 / 改档存成字符串 `reader:toolbarRows` / 怪值回 4）、
  `ReaderToolbar` 补 2 条（4/3/2 档的行数与 `.tb-sep` 数量、合并后 `.tb-settings` 仍在最后一行；
  改 select 回调收到的是数字）、`ReaderToolbarHost` 夹具补 `display.toolbarRows`。
  「选中朗读」从视图行挪到「显示 ⚙」右边（用例断言它不再出现在视图行、且是最后一行的末项）。
  实测（mock 引真实 CSS + headless 量 `getBoundingClientRect`）：1080 视窗三档都在 ~190px（宽度被压住，合并行会折）；
  1366 起 3 行档 155px、2 行档要 1920 且 `auto` 才落到 108px —— 行数少了要更宽，窄屏靠 `flex-wrap` 折行兜底。
- **顶栏按钮区宽度（2026-10-20 第四批）**：`core/toolbarWidth`（7：四档识别 / 脏值回自适应 /
  `auto` 是 `fit-content` 不是写死像素 / 800 下限 / 固定档带视窗上限 / 任何档都不出 NaN）、
  `useReaderPrefs` 补 1 条（默认自适应 / 改档写进 `reader:toolbarWidth` / 怪值回自适应）、
  `ReaderToolbar` 补 1 条（`.tb-inner` 的 `style.width` 随档位变，改 select 走回调）、
  `ReaderToolbarHost` 夹具补 `display.toolbarWidth`。宽度规则不写在 CSS 里手算，避免「CSS 一套、JS 一套」。
- **AI / 考试三个大 hook 也拆干净了（2026-10-20 第二批）**：`core/aiApply`（16：六个表格型任务的解析 / 校验 / 回执，
  含「自己当自己的易混词」「词库里没有这个词」「AI 未返回」三类分支）、`core/quizPool`（13：范围 → 候选池、
  各范围题量、`unique` 开关下每词最多一题）、`adapters/aiRun`（8：起跑 / done / error / 没配 key /
  连续 20 次失联 / 取消后不再请求 / 定时器清干净）、`hooks/useQuizSettings`（5：默认值 / 坏 JSON 回默认 /
  文章级题型表混进词级题型只留文章级 / 写入落盘）。
  三个 hook 的原有测试一条没改：`useApplyTaskResult` 13、`useQuizSession` 8、`useAiPack` 10。
- **panels 35 / 35 有测试**：本轮补齐 `SpeedReadPanel` / `SidePick` / `StudyPanel` / `DictPanel` / `QuizPanel` /
  `IntensivePanel` / `GoalPanel` / `JournalPanel` / `ListeningPanel` / `WritingPanel` / `LanguageEditor` /
  `QuickPanel` / `QuizSetupPanel` / `StatsPanel` / `PlanPanel` / `Composer` / `SideOverview` / `SideMastery` /
  `LangPhrases` / `VocabBlocks` / `ReaderBody` / `ReaderSidebar` / `ReaderToolbar`（薄容器 `ReaderSidebar`
  用 stub 子面板只测页签接线）。`SidePick` 582 行拆成 `SidePickBatch` / `SidePickDictTools` / `SidePickAiPack`
  （3 + 2 + 6 条），原 10 条面板级测试继续覆盖整块接线。
- **adapters 11 / 16 有同名测试，其余按需补**：已覆盖 `dictionary` / `tatoeba` / `ttsCache` / `browserAudio` / `learningRepo` / `aiRun` /
  `stateBackup` / `hybridMode` / `vocabRepo` / `sqliteRepo` / `audioPick`；`articleRepo` / `storeApi` 由
  `server/*.test.js` 间接覆盖；三个脚本/跟读仓储依赖真实浏览器/IndexedDB，走 §4 人工用例
  （R7 只要求 `core/`，adapters 不强制同名测试）。`browserAudio` 的测试用假 `Audio` / 假 `AudioContext`
  钉解码、区间播放、录音归一化缓存与 `release` 回收，真实播放/麦克风仍走 §4。
- **`core/vocab` 已按职责拆分**：`word` / `merge` / `analysis` / `library` / `review` 各有同名测试，
  `vocab.test.ts` 只守住 facade 的 re-export 与跨模块流程；原 102 条测试按子模块搬走，未删减。
- **答题事件（v7）**：`core/answerEvents` 9 条（坏事件丢弃 / 上限 / 从事件重建活动与题型统计）；
  `sqliteStore` 钉住事件落库、迁移基线、`rebuildLearningDerived` 的「baseline + events」口径；
  三个会话 hook 各加一条「每题都追加事件」的接线断言。
- **跟读模块（旧模块）也有了纯规则测试**：`core/recording`（7：兜底时长夹取 / 自适应阈值）、
  `core/scriptAlign`（13：比例摊 / 正文起点 / 平移 / 锚点优先 / 锚点解析不出来时退回）、
  `core/anchorEdits`（14：撕开按比例拆 / 合并并回前一个 / 微调夹在邻居之间）、
  `core/takeChunk`（15，含 `remapTakes` / `latestTakePerChunk`）、
  `core/chunkEditLog`（10：撕 = 抵消合并 / 合并 = 撤销撕开 / 容差内不重复记）、
  `state/calibrationLedger`（11：分篇 / 空数组等于删键 / persist 不写空键）、
  `state/shadowingPrefs`（8：脏值兜底 / 隐私模式读写不炸）、
  `state/fishPrefs`（6：按页面分开存 / 脏值回默认 / 写失败不抛）、
  `state/levelMeter`（6：首拍直发 / 窗口内只发一次且补尾帧 / flush 清定时器）、
  `state/localActivity`（7：同键累加 / 派发 `reader:local-state` / 坏数据当空库 / 元素级脏数据只丢坏行）、
  `ui/ScriptPanel`（8：未粘原文 / 原文库失败提示 / 当前块与邻块标记 / 编辑态提交 / 锚定与两步清空）。
  会话测试按主题拆成五个（共用 `state/sessionDoubles` 的假播放器/录音器/仓库）：
  `sessionLoad`（10）/ `sessionPlay`（16）/ `sessionRecord`（21）/ `sessionCycle`（22，含 A/B 与整圈时序）/
  `sessionScript`（55：原文对齐 / 自动带原文 / 偏移 / 撕合 / 改文本）。
  `state/anchorEditor` 与 `state/cycleRunner` 没有单独文件：它们的行为由 `session*` 五个文件从公开 API 覆盖
  （拆出去是为了让 store 只剩编排，不是为了少测）。
  真实播放、录音、撕块波形仍走 §4 人工用例。
- **覆盖不到的（人工用例见 §4）**：A4 打印版式、TTS 发音、真实 IndexedDB 库、离线词典/例句文件。
- **覆盖率数字**：接 `@vitest/coverage-v8` 再看（先求「该测的层有测试」，再求百分比）。

## 六、执行

```bash
npm test                      # 全部（270 个文件 / ~2475 项，约 45 秒）
npx vitest run src/core/langPoints.test.ts   # 定向：开发循环用这个
npm run gates:fast            # 改动相关测试 + tsc + 静态门禁（开发循环）
npm run gates:core            # 只跑 core / adapters
npm run gates:ui              # 只跑 reader / ui / state
npm run gates:server          # 只跑 server / tools
npm run gates:static          # 只跑上帝文件 / 架构 / 词汇义项
npm run gates                 # 全量收尾门禁（提交前 / CI 必跑）
```

- **分层不是替代全量**：`gates:fast` 只看“改动的文件有没有同名测试”，
  共享 core / 类型改动可能影响 import 方；提交前仍必须跑 `npm run gates`。
- **别加 `--no-file-parallelism`**：全量 270 个文件串行要 ~10 分钟（jsdom 环境是大头），
  并行只要 **45 秒左右**。要限并发就 `--pool=forks --maxWorkers=4 --minWorkers=1`
  （只给 `--maxWorkers` 会和默认的 minForks 打架，报 `options.minThreads and options.maxThreads must not conflict`）。
- **`check_vocab_sense` 读的是压缩 payload**：`data/xueba.db` 的 `vocab.payload` 现在是
  gzip BLOB，脚本里必须 `gunzip` 后再 `JSON.parse`；直接 `String(payload)` 会得到一串逗号数字。
- 机器是 **16GB 物理内存**（开发机），并发开满会互相挤；tsc 报
  `Fatal process out of memory: Zone` 是系统提交内存（物理 + 页面文件）见底，不是配置问题：
  等一会儿再跑，或 `--max-old-space-size=2048`。

32. **词库落盘是「合并写」，不是「点一下就写」**（2026-10-23）。`persist()` 只更新 state/ref，
    落盘推迟 300ms（连续操作合并成一次），最迟 1200ms 强制落一次，卸载/`visibilitychange`/`pagehide`
    时立即 flush；保存还串行排队（并发 save 会拿同一个 base 版本号，后一次必然 409）。
    测试要 `await waitFor(() => expect(saved).toHaveLength(1))`，**不能同步断言**；
    组合窗口相关的断言用导出的 `PERSIST_DELAY_MS` / `PERSIST_MAX_WAIT_MS`。
33. **整库数据别「parse 再 stringify」发出去**（2026-10-23）。`GET /vocab` 现在是
    「库里那段 JSON 原样拼进响应 + 按需 gzip」：16.3MB / 1.4s → 1.5MB / 0.46s。
    改这条读路径时注意两点：① 三张词库表的 payload 都是 **gzip BLOB**，读一律走 `unpackPayload`；
    ② 响应形状必须还是 `{ ok, value, updatedAt, count }`，前端 `vocabRepo` 只认这个。
    加新的大接口照抄 `sendBigJson`（`Content-Encoding: gzip` + `Vary`），别每次搬 16MB。
34. **整页会话只写 `useState` = 返回键直接回根页**（2026-10-23）。背单词 / 考试 / 快刷 / 听写 /
    听力 / 仿写 / 语言点编辑 / 新建文章这些「一打开占满正文」的界面，以前只是布尔/队列状态，
    地址栏不变；用户按返回键就退出阅读器，现场全丢。现在两类状态都进 URL：
    布尔面板走 `route.ts` 的 `useRoutedPanels`，整页会话走 `hooks/useRoutedFlows`。
    改这块时记住三条：① 点按钮打开要 **push**、页面内点退出要 **replace**；
    ② URL 回退时 `close()` 必须真能关（拼写判错之类不能把用户卡住）；
    ③ 深链接打开失败要回落文章页，且失败判定要再渲染一次（`bump()`）——
    只调 `open()` 不一定产生状态变化，不 re-render 就永远判不到失败。
    路由纯函数测试的期望路径都带 `/reader` 前缀（单入口后不再有 `basename`）。
    另外：阅读页 CSS 必须 `?inline` 注入/卸载，普通懒加载会把 `<link>` 永久留在 head，
    返回跟读页后全局样式仍被阅读页覆盖（见 `ReaderRoot`）。
35. **打开文章不是改动，别让自动保存顶掉日期**（2026-10-24）。`useReaderDoc` 的自动落盘
    effect 依赖 `doc` / `savedId`，点一下文章列表就会触发；以前 900ms 后无条件写库，
    `updatedAt` 变新，列表里 10-01 建立的文章会变成「今天更新」。
    现在用 `core/articleMeta.articleFingerprint` 比对「已落盘版本」和当前编辑器内容，
    指纹相同就跳过；覆盖保存把原 `createdAt` 一起带上，服务端 `saveArticle` 在客户端没带时
    也沿用 `articles.created_at`。改自动保存 / 文章日期时，测试至少覆盖：
    打开不写库、真改才写、覆盖保存保留 `createdAt`。
36. **`server.fs.deny` 是“替换”不是“追加”**（2026-10-24）。手写 `['**/data/**']` 会把 Vite
    默认的 `.env` / `.env.*` / `*.{crt,pem}` 拒绝列表整体换掉，还会把根目录的
    `config.local.json`（`ai.apiKey` 就在里面）当静态文件吐给任意 localhost 页面。
    策略现在集中在 `server/privatePaths.js` 的 `PRIVATE_FS_DENY`，由 `vite.config.ts` 引用；
    改它时保留 `**/config.local.json`、`**/.env*`、`**/*.{crt,pem}`、`**/data/**`。
    验收：`curl -H "Origin: http://localhost:9999" http://localhost:5173/config.local.json` 必须 403/404。
37. **只比 `Origin.host === Host` 防不住 DNS 重绑定**（2026-10-24）。把 `evil.com` 解析到
    127.0.0.1 后，浏览器发来的 Host 和 Origin 都是 `evil.com`，两者相等但页面不是本机。
    `server/sameOrigin.js` 现在先要求 Host 的 hostname 属于 `localhost` / `127.0.0.1` / `[::1]`，
    再比较 Origin 与 Host；dev 插件和静态 `appServer` 共用这一层。补测试时同时断言
    “Host、Origin 都是 evil.test → 403”和“本机名 → 放行”，只测 Origin 不一致会漏掉重绑定。
38. **路由同步 effect 别把“返回”当成“首屏恢复”**（2026-10-24）。`/reader/a/<slug>` 按返回后
    `routeSlug` 变空，旧代码的“有文章但 URL 没它 → 补 URL”会立刻把文章 push 回去，
    返回键看起来像死循环。`useArticleRoute` 现在用上一次 URL 的 slug 判断
    `backToList = 有→无`：首屏空 URL 恢复文章仍 push，真正返回只清文章、不再导航。
    面板侧同一套语义：打开 `push`，页面内关闭 `replace`；包装 setter 必须支持
    `setStatsOpen(v => !v)`（按 `panelFlags(route.panel)` 求值），不能把函数当 truthy。
    测试要断言 `location.key` 不变 / `useNavigationType() === 'REPLACE'`，只看 pathname 抓不到重复 push。
39. **学习记录必须“先水合、后挂载”**（2026-10-24）。`ReaderRoot` 旧逻辑在本地有缓存时立刻挂
    `ReaderApp`、后台 `hydrateLearningFromServer()`；React state 已经用旧缓存初始化，服务端较新的
    记录只写进 localStorage，用户一改就整块盖回旧数据。现在无条件等水合（最多 3s）再挂，
    测试要覆盖“水合 pending 时不能出现 ReaderApp”“失败/超时仍能画”。学习记录的 localStorage
    键只在 `core/learning.ts` 的 `LEARNING_KEYS` 里写一次；新加字段时 `LEARNING_KEYS` 与
    `LearningData` 必须同步，`core/learning.test.ts` 会查两张表是否一一对应。
40. **IndexedDB 升级只建一半 store，功能会静默失效**（2026-10-24）。`shadowing-vocab` v1 只建了
    `library`，`snapshots` 不存在；`db.transaction('snapshots')` 同步抛 `NotFoundError`，被
    `save()` 的 try/catch 吞掉 —— 快照从来没写成过，`loadSnapshot()` 还从 `library` 里取，永远 null。
    改 store 时 `onupgradeneeded` 必须把**所有** store 建齐，并升 `DB_VERSION`；写事务等
    `oncomplete` 再 resolve（request success 早于提交）。测试用 `fake-indexeddb` 真开库，
    覆盖「新库两个 store」和「v1 旧库升级保留数据」。只 mock `indexedDB` 的 open 调用测不出来。
41. **读失败后的 `revision=null` 不是“没有版本”**（2026-10-24）。`HybridVocabRepo` 读 `/vocab` 失败时
    如果继续用 `null` 当 base 去 PUT，服务端会当成强制覆盖，本地旧镜像把别处的新词库抹掉。
    现在 `revisionKnown=false`，恢复后第一次写先补 `GET /vocab`：服务端有数据就按 409 冲突拒绝，
    只有空库才允许写。测试要模拟「读失败 → 30s 后服务恢复」，断言**没有发无 base 的 PUT**；
    同时覆盖 `useVocabLibrary` 保存失败后自动退避重试（1s 起）。
42. **“镜像写入时间新”不等于“本机有未同步改动”**（2026-10-24）。每次服务端保存成功也会写
    IndexedDB 镜像，镜像时间通常比 `/vocab.updatedAt` 晚几毫秒；拿它做本地优先的判据，会把
    另一台设备刚写入的词库当成旧版。现在只有**服务端写失败/服务不可用**落盘时才置
    `vocab:dirty`（v3 的 `meta` store），`load()` 看到脏标记才允许本机优先；正常镜像一律用服务端。
    测试要覆盖「正常镜像 → 用服务端」「确实脏 → 用本机」「保存成功 → 清脏」。
    真正两边都改过时目前仍会本机优先（会弹一次提示），合并/冲突选择是后续债务。
43. **取消跑批只 abort 本地轮询 = 服务端继续花额度**（2026-10-24）。`runJobs` 现在接收
    `AbortSignal`（每轮/每次请求前检查、退避等待可打断），`POST /api/ai/cancel` 真正停服务端。
    **启动窗口也要能取消**：runId 由客户端生成（`/api/ai/run?runId=`），服务端在 `readBody`
    之前就 `runs.set` 占位；取消请求先到则留墓碑（`cancelledRuns`），后到的启动直接判取消。
    取消了就 `keepalive: true` 发取消请求，并在 `finally` 里等它发完。测试要断言
    **取消后不再发新的模型请求**，且启动响应没回来时取消也能命中
    （`tools/ai-core.test.mjs` 的 `handleAiApi` 用例 + `adapters/aiRun.test.ts`）。
44. **句子原文别按词重复存**（2026-10-24）。同一个 `sentenceId` 会被 `source` /
    `contexts` / `articleEntries` 多处引用，每处各存一份 `sentenceText` 会多出几 MB。
    落盘统一走 `core/vocab/sentenceTexts` 的 `compactSentenceTexts`（收进
    `library.sentenceTexts`，键 = `articleId|fileName` + NUL + `sentenceId`），读出走
    `hydrateSentenceTexts` 补回。**同键文本不一致时不要合并**（可能改过正文），保留各自原文；
    `compact` 必须幂等，测试覆盖 source / contexts / articleEntries 三处和冲突分支。
45. **没有墓碑的“合并”会把删掉的词复活**（2026-10-24）。本机删了词、服务端还留着，
    只按 lemma 取并集就会把它并回来；整库二选一又会丢另一边的新增。现在删除写
    `library.tombstones`（`kind` + `key` + `at`），合并时按 `updatedAt` / `addedAt`
    与墓碑时间比较：比墓碑旧的删除，比墓碑新的保留（删完又加回来）。
    测试要覆盖「本机删 / 服务端有」「服务端删 / 本机有更新版本」「篇条目墓碑」
    「删全库连带清篇收录」；只测 `removeItem` 不测合并等于没测。
