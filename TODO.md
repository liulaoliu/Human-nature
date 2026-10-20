# TODO

> **2026-10-20 最新交接（换电脑先看这段）**
>
> - 分支 `main`，最后提交见 `git log -1`（本轮最后一条是「docs: 滚动进度 / 速读游标」）；工作树干净。
> - schema **v7**；`npm run gates` 全绿：205 个测试文件，**1837 passed / 5 skipped**。
>   （跑门禁记得带 `TMPDIR=/home/Gxkj-123/.workbuddy/tmp/vitest`，这台机器 `/tmp` 只有 10MB）
> - 数据不在 git 里：换电脑先看 [`docs/HANDOFF.md`](docs/HANDOFF.md) 的「换电脑怎么把数据带走」。
> - 本轮已完成：
>   - **统计页「重建并核对」**（`core/learningCheck` + `hooks/useLearningRebuild`）
>   - **列表无障碍**（重复动作按钮带条目名 + toast `aria-live`）
>   - **跟读模块瘦身**：`state/session` 1185 → **732**、`ui/App` 1191 → **624**、
>     `reader/ReaderApp` 1036 → **781**；`state/session.test.ts` 1057 → 拆成四个按主题的测试
>   - **上帝文件 BASELINE 清空**（`tool/check_god_file.mjs` 里已经没有存量），新文件超 800 行一律拆
>   - **架构门禁豁免只剩 1 条**：`core/stateBackup` 的 R6（备份文件名里的 UTC 日期，故意不动）；
>     `ui/App` / `ui/ChunkSplitter` / `ui/FishLayer` 的 R3 债全部销账
>   - 顺手修的：`state/localActivity` 遇到坏的 `reader:activity` 不再把这笔记录丢掉（当空库继续记）
> - 第二批（同日，可读性瘦身）：三个「AI / 考试」hook 拆完，规则各回各家
>   - `hooks/useApplyTaskResult` 508 → **410**：六个表格型任务的解析/校验/回执 → `core/aiApply`（16 条测试）
>   - `hooks/useQuizSession` 535 → **437**：设置 → `hooks/useQuizSettings`（5 条）、
>     候选池/出题集 → `core/quizPool`（13 条）、`isArticleKind` → `core/quiz`
>   - `hooks/useAiPack` 587 → **505**：起跑 + 轮询 → `adapters/aiRun`（8 条）、`jobPhaseLabel` → `core/aiPackage`
>   - 三个 hook 原有测试一条没改（13 / 8 / 10 全绿）；hook 覆盖 53 → **54 / 54**
> - 第三批（同日，阅读体验）：
>   - **阅读页滚动进度按文章记住**：`core/scrollProgress`（12）+ `state/scrollPrefs`（10）+
>     `hooks/useReadingScroll`（9）；内存优先、重开回落到 `reader:scroll:<文章标识>`；
>     存的是比例（换字号/衬线不错位），停滚 400ms 落一次盘
>   - **「同一篇」认正文签名**：`core/docSignature`（5 条）——文章标识可能是书名 / 空标题 / 「未命名」，
>     凡按文章记东西键里都带它（滚动进度、速读游标都用了）
>   - **速读游标不串篇 + 读完即归零**：键改成「文章标识 + 正文签名」（`core/speedRead.speedCursorKey`），
>     停在/读完最后一句再退出就清零；面板没关就换文章也会重置游标与成绩；hook 覆盖 54 → **55 / 55**
> - 第四批（同日，顶栏排版）：按钮区不再铺满视窗
>   - 宽度规则收进 `core/toolbarWidth`（7 条测试）：默认 `fit-content` + 800 下限 +
>     视窗上限，也就是「按钮多宽就多宽」，1080 和 2560 下是同一块、同一个位置
>   - 顶栏拆成「背景条铺满 + 里面 `.tb-inner` 定宽」，左边缘与正文/标题同一条竖线；
>     四行按钮各自定宽不收缩，窗口拉伸不会把按钮推来推去
>   - 「显示 ⚙」里加了宽度档位（自适应 / 窄 / 宽 / 铺满），选择存 `reader:toolbarWidth`（`useReaderPrefs`）
> - 下一步优先级：
>   1. [ ] 真机验证：听写 diff / 理解题 / 仿写 / 语言点 / 写作历史 / TTS、跟读页（录音 / 撕块 / 选字锚定）、
>      以及「统计 → 重建并核对」。（**用户自己做**）
>   2. [ ] 观察项（不修，已钉测试）：跟读「合并 → 撕开 → 再合并」，最后一刀会被当成「撤销撕开」，
>      块又按 VAD 边界裂开。要修得让 store 知道「这条边界是不是 VAD 本来就有的」，
>      得动 `applyChunkEdits` 的口径，收益不值当。见 `core/chunkEditLog.ts` 注释。
>   3. [x] 可读性瘦身：`useAiPack` 587 → 505、`useQuizSession` 535 → 437、`useApplyTaskResult` 508 → 410
>      （规则分别落到 `adapters/aiRun` / `core/quizPool` + `hooks/useQuizSettings` / `core/aiApply`）。
>   4. [ ] 记录分页（P2）：**先不做**，触发条件写在这里，到了再做，别提前上
>      - 渲染层现在不需要它：`StatsPanel` 只取最近 8 条（`recentPractice`）、日志按天过滤、
>        错题本只算类型计数——没有任何一处把整份记录 `map` 出来。
>      - 要分页得**同时**满足：① 某个列表真要往回翻到全部；② 单次渲染超过约 200 行
>        （DOM 200 → 1000 行，首屏渲染大致 20ms → 150ms+）；③ 数据层不再截断
>        （`core/mergeBackup` 现在 练习 500 / 错题 300 / 写作 200 / 复述 200 / 会话 500，
>        恢复备份时更早的记录本来就没了，分页也翻不出东西）。
>      - 看这几个数字就够判断：`reader:practice` > 300 条、`reader:answerEvents` > 2000 条，
>        或 `reader:practice` 这个键 > 200KB（约 1500 条；每加一条都要整段 stringify + 同步写）。
>      - 真做的时候：服务端 `limit/offset`（SQLite 里已有表）+ 按 `at` 倒序的游标分页，
>        别在全量数组上 `slice`。
>
> 下面「Review 重构待办（2026-10-19）」保留为历史记录，里面的事项均已完成；
> 更早的录音 / PDF 抽取待办仍然有效，但别把旧状态当成最新状态。

> **2026-10-19 历史交接**：最新数据安全进展、换电脑带数据的步骤、下次优先做的事件表/分页，
> 见 [`docs/HANDOFF.md`](docs/HANDOFF.md)。本文件下面很多是较早的录音/抽取待办，
> 仍然有效，但别把旧状态当成最新状态。

## Review 重构待办（2026-10-19，一个一个改）

> 来源：[`docs/reviews/2026-10-19-full-review.md`](docs/reviews/2026-10-19-full-review.md) 里仍标 🟡 的项。
> 规矩：一次只做一个主题，做完单独 commit，提交前 `npm run gates`。

- [x] **ReaderApp 拆分 ①**：把工具栏 + 正文 + 侧栏抽成 `ReaderShell`，先只搬渲染，不改行为
      （`ReaderShell` 布局 + slot、`ReaderArticle` 正文、`panels/ReaderSidebar` 侧栏；新增 7 条组件测试）
- [x] **ReaderApp 拆分 ②**：各练习面板路由抽成 `SessionHost`（背词/考试/听写/听力/速读/仿写）
      （会话面板 props 映射移进 `SessionHost`；ReaderApp 只传 hook 结果，2733 → 2423 行）
- [x] **ReaderApp 拆分 ③**：把 `reader:batch` / `reader:last` 等散落 IO 移进对应 hook；验收 ≤1200 行
      （已完成 `reader:batch` → `useBatchQueue`、预生成 → `usePregenerate`、启动加载 → `useArticleBootstrap`；
      当前 **1040 行**（已达标 ≤1200）。散落 IO 基本收口，剩下的是接线与派生，按下面四刀往下切，每刀单独 commit + 跑门禁）

      **明天再战（每刀一次 commit，先补测试再搬）**
      1. [x] **派生统计簇**（风险最低，约 -100 行）：把 `totals` / `studyStats` / `todayCards` / `todayWrites` /
             `dayStats` / `last7` / `dueForecastRows` / `savedGroups` / `byArticle` / `confusableTodo` /
             `confusableBatch` / `lemmaCandidates` / `posCandidates` / `visibleBatch` 抽成
             `useReaderDerived({ library, sessions, studyDays, batch, ... })`；纯派生无副作用，用 `renderHook` 钉住
             几个关键输出即可。验收：`ReaderApp` 掉 ~100 行，行为不变。
             （已完成：`hooks/useReaderDerived.ts` + 9 条 hook 测试；日期键统计抽到
             `core/writing.countWritesOnDay` + 2 条 core 测试。`ReaderApp` 2424 → 2377 行，
             基线同步降到 2377；`npm run gates` 全绿）
      2. [x] **侧栏宿主**（约 -130 行）：新增 `ReaderSidebarHost`，接收 hook API 整包（`aiPack` / `aiTasks` /
             `useExport` / `useDictTools` / learning 等）与少量状态 setter，在宿主里拼出
             `overview` / `mastery` / `stats` / `pick` / `vocab` 五组 props；`ReaderApp` 只传 `sideTab` + 宿主 props。
             先给宿主挂一个「假 API → 断言分组对象字段」的组件测试。验收：`ReaderApp` 掉 ~130 行。
             （已完成：`ReaderSidebarHost.tsx` + 10 条组件测试（假 API 映射 / 派生字段 / 会话按钮顺序）；
             `ReaderApp` 侧栏接线 190 行 → 宿主调用；`ReaderApp` 2377 → 2213 行，基线同步降到 2214；
             `npm run gates` 全绿）
      3. [x] **工具栏宿主**（约 -70 行）：同法抽 `ReaderToolbarHost`，把 `toolbar={...}`（约 76 行）整块搬走。
             （已完成：`ReaderToolbarHost.tsx` + 6 条组件测试；进度条/版本筛选仍由 `ReaderApp` 持有并传入。
             实际 2213 → 2190 行（-23）：顶栏多为分散的标量状态，能整包搬的只有 `useReaderDoc` / `pregen` / `tts`）
      4. [x] **会话外回调归位**（最大块，约 -250 行）：把 `retryMistakeVocab/Listen/Dict`、`commitBatchItems`、
             `addItemsToVocab`、`addPhrasesToVocab`、`removeWordFromVocab`、`copyLanguagePrompt`、`applyPaste`、
             `copyMissingAgain`、`applyAnyPaste`、`handleReview`、`handleEdit`、`saveRetell`、`deleteRetell`、
             `startSiege`、`toggleSkimmed` 按归属收进对应 hook（词库写入口仍只能有一个），每个 hook 补
             「成功 / 坏输入 / 幂等」测试。这刀最大，可以再拆成 2–3 个子主题分别提交。
             - [x] **4a 词库增删**：`commitBatchItems` / `addItemsToVocab` / `addPhrasesToVocab` /
                   `removeWordFromVocab` → `hooks/useVocabEdits`（+9 条钩子测试；`ReaderApp` 2190 → 2115）
             - [x] **4b 提示词复制**：`copyLanguagePrompt` / `copyMissingAgain` → `hooks/useAiTasks`（+6 条钩子测试）
             - [x] **4c 粘贴应用**：`applyPaste` / `applyAnyPaste` → `hooks/usePasteApply`（+9 条钩子测试）
             - [x] **4d 复述 / 略读**：`saveRetell` / `deleteRetell` / `toggleSkimmed` → `hooks/useLearningData`（+4 条钩子测试）
             - [x] **4e 错题重练 / 包围战**：`retryMistakeVocab/Listen/Dict` / `startSiege` → `hooks/useMistakeActions`
                   （+7 条钩子测试；4a–4e 合计 2190 → 1993，-197）
             - 小结：四刀切完 `ReaderApp` 从 2424 降到 1993；离 ≤1200 还差约 800 行，下一轮继续找宿主边界。
      5. [x] **浮层面板宿主**：速读 / 语言点 / 计划 / 包围战 / 目标 / 导出 / 日志 / 全部生词 →
             `ReaderOverlaysHost`（+6 条组件测试；`ReaderApp` 1993 → 1946）。
             下一批候选：选区状态（exact/selIndices/ctrl/alt）、新建/导入态、显示偏好。
      6. [x] **选词模式状态机**：开关 / 计时 / 切走暂停 / 关闭记会话 → `hooks/useVocabMode`
             （+6 条假计时器测试；`ReaderApp` 1946 → 1892）。
      7. [x] **本篇派生**：掌握度 / 精读工作流 / 本篇复述 / 产出看板 → `hooks/useArticleDerived`
             （+5 条钩子测试；`ReaderApp` 1892 → 1784）。
      8. [x] **视图派生**：就绪清单 / 学习日志 / 打印索引 / 测验数 → `hooks/useReaderViewData`
             （+5 条钩子测试；`ReaderApp` 1784 → 1741）。
      9. [x] **文章工作区**：文档动作组装 / 新建导入态 / 语言点编辑 → `hooks/useArticleWorkspace`
             （+6 条钩子测试；`ReaderApp` 1741 → 1696）。
      10. [x] **会话服务层**：背词 / 考试 / 听力 / 快刷 / 听写 / 仿写 + 选词计时 + 错题重练
              → `hooks/useSessionServices`（+6 条钩子测试；`ReaderApp` 1696 → 1547）。
      11. [x] **AI 服务层**：复制提示词 / 应用结果 / 工作包 / 粘回路由 → `hooks/useAiServices`
              （+3 条钩子测试；`ReaderApp` 1547 → 1486）。
      12. [x] **正文小动作**：Alt 复制 / 两步删除 / 逐词高亮 / 点句朗读 / 生词定位 / 听写播放 / 离线例句
              → `hooks/useArticleUiActions`（+7 条钩子测试；`ReaderApp` 1486 → 1409）。
      13. [x] **视图拆分**：外壳 / 工具栏 / 侧栏 / 会话 / 面板 / 正文的槽位映射 → `ReaderScreen`
              （控制器与视图分离；`ReaderApp` 1409 → 1040，低于 1200 目标）。

      **验收与红线**：每刀 `npm run gates` 全绿（含上帝文件门禁，`ReaderApp` 基线只准下调）；不新增读写词库的
      effect（写入口仍只有 `useLibraryAutoFill` / `persist`）；拆完 `ReaderApp` 行数同步下调
      `tool/check_god_file.mjs` 的 `BASELINE`。全部切完再回头核对 ≤1200 的目标，若仍不达标继续找新的宿主边界。
- [x] **面板瘦身**：`SpeedReadPanel`（779 → 597）/ `StudyPanel`（746 → 512）拆「渲染块」与「会话状态机」
      （`StudyDrill` 抽出强制锤炼；速读拆出 `SpeedReadSentence` / `SpeedReadBasket` + `SpeedReadDone`；新增 12 条组件测试）
- [x] **补 hook 测试**：`useQuizSession`、`useDictation`、`useSpeaking`、`useAiPack`、`useExport` 各补「初始/成功/失败/卸载」
      （共 36 条：`useExport` 8、`useQuizSession` 8、`useDictation` 8、`useSpeaking` 6、`useAiPack` 6；
      定时器类 hook 用 `clearTimeout` 断言卸载清理，纯回调 hook 无卸载副作用）
- [x] **ReaderApp 集成测试**：假仓储挂载，断言自动补全只写一次、导入 AI 结果不重不漏
      （`ReaderApp.integration.test.tsx`：mock 仓储/词典/例句加载，恢复上次文章 → 补全写一次；
      粘回语言点 JSON → 写进词库一次、同份结果再应用不重复；顺带修了热力图月份 key 重复）
- [x] **`catch {}` 分类**：用户资产 IO 一律 `console.warn` + 可见提示；可选能力保留空 catch 并写明理由
      （新增 `reportStorageFailure`；词库读失败/学习记录写失败/待选写失败/文章列表读失败都已可见；
      TTS、剪贴板、`navigator.storage.persist()` 等保留空 catch 并注明可降级）
- [x] **无障碍**：给划词/悬浮气泡/纯图标按钮补 `aria-label`，键盘可走到主要操作
      （纯图标按钮已补：改名/编辑/删除/朗读/前一天/后一天等；句子加 `role=button`+`tabIndex`+Enter/Space，
      选词气泡加 `role=status`+`aria-live`，`ReaderArticle.test` 钉住）
- [x] **词库增量 upsert**：按 `id + 内容` 只重建变化的词条，替代每次全量 clear + rebuild
      （`server/sqliteStore.js` 按 `id + 内容` 对比：只删/重写变化与删除的词条；新增 1 条 rowid 稳定性测试）

## 听说读写扩展（本轮）

**状态：听、写各模块 MVP 已做，真机待验**

读（精读）/ 说（跟读）之外，已补「听」和「写」。AI 出题 / 给答案 / 批改三处提示词都按**严格 JSON schema** 写，解析层丢弃不合格项。

### 听（已做）
- [x] **听音拼词**：`core/quiz` 加 `ear` 题型（只放音、不给文字），进 SRS
- [x] **逐句听写 + diff**：`core/dictation.ts`（词级 LCS，标漏写/多写）；阅读页「听写」，漏写词可加入待选
- [x] **听力理解题**：`core/listening.ts`（严格 JSON 出题 + 解析校验 + 本地判分）；阅读页「理解题」，按篇存 localStorage
- [ ] 音频源：默认 TTS；**真实音频优先**（需下载音频后接入，见下）

### 写（已做）
- [x] **逐句语言点分析**：`core/language.ts`（结构/语法/idiom/词组/用法，写回 `Sentence.language`）；阅读页「语言点」+「显示语言点」
- [x] **仿写 + AI 严格批改**：`core/writing.ts`（出任务 + 评分 rubric + 批改）；阅读页「仿写」

### 待办
- [x] **写作练习历史**：批改后自动存一条（时间/文章/范句/作答/批改），仿写面板「历史」可回看/清空
- [ ] 真实音频：**暂不做**（需下载 mp3；当前统一用 TTS）
- [ ] 口语评分：**暂不做**
- [ ] 真机验证（**用户自己做**）：听写 diff、理解题判分、仿写两轮闭环、语言点显示、写作历史

## 精读 / 生词本（新功能，本轮）

**状态：核心 + 页面已做，真机待验**

已做：

- 数据模型 `src/types/document.ts`
- 清洗 `core/cleaner.ts`、切分 `core/segmenter.ts`、词库 `core/vocab.ts`、提示词 `core/analyzer.ts`、
  近似对齐 `core/aligner.ts`、导出 `core/exports.ts`（各带测试，全库 355 通过）
- IndexedDB 词库 `adapters/vocabRepo.ts`（独立库 `shadowing-vocab`，不动录音库）
- 精读页 `reader.html` / `src/reader/ReaderApp.tsx`：阅读 / 划词标生词 / 一键提示词 / 粘回 / A4 打印 / Anki CSV / SRS
- 抽取清洗：`tools/extract-articles.py` 加了软连字符与断词修复（2016 输出逐字节不变）；
  `tools/clean-articles.py` 就地清了现有库的 30 篇软连字符

待办：

- [ ] 用**带音频目录**的完整流程重跑 `extract-articles.py`，彻底修 2021 的粘连
      （现有库里的 `soundingout`、`Mississip pi's` 是旧的坏数据，就地清洗救不回来）
- [ ] 起点截断（开头半句话）仍要按版面几何定起点，未修
- [x] 词库备份已接进「导出全部（备份）」：词库 + 文章 + 学习记录（含答题事件）一个 JSON；覆盖/合并导入都支持
- [ ] 真机验证 `reader.html`：划词、复制提示词、粘回、A4 打印、Anki 导入
- [ ] 句子级近似时间轴只在单测里验过，未在真实音频上校准
- [ ] **自动标词「本地词表白名单」模式**：内置四/六级、雅思分级词表（约几百 KB），
      让 AI 只筛「不在白名单里的词」，或纯本地标词（更准、更省钱、可复现）。
      现在先用「按水平描述」的 AI 版；需要时再做词表版。

## 2021-06-12 那期：已写出 30 篇，3 篇开头待修

素材（本地，不进仓库）：2021-06-12 那期的 PDF（86 页）+ 配套 74 个 mp3。
时长表用 `docs/PIPELINE-PDF.md` 里的 ffprobe 命令现生成。

跑法：`py tools/extract-articles.py --profile=2021 "<pdf>" "<音频目录>" <输出> <时长表>`

**2021 换了整套字体，2016 的常量一个都不匹配：**

| | 2016-09-10 | 2021-06-12 |
|---|---|---|
| 正文 | `EcoNewtext-Roman` 8.8pt | `MiloTE` 11.9pt |
| 正文大标题 | `OfficinaSanITC-BoldOS` 9.0pt | `MiloLNTE-Bold` 24.6/32.7pt |
| 行首标签(kicker) | 无 | `EconSansOSMed` 11.6pt |
| 结尾花饰 | `EcoPict-Two`（`7`） | `ZapfDingbatsITCTT`（`\x81`） |
| 目录写法 | 标题在前，靠标题字体认 | 页码在前，靠行首数字认 |
| 页眉高度 | y < 30 | y = 33 |
| 印刷页映射 | 恒为 `doc + 1` | 插入整页广告，偏移 0 → 2 |
| 文件名 | `009 Leaders - Interest-rate caps.mp3` | `005-Leaders---The-green-boom-<32位哈希>.mp3` |

### 已做完
- [x] 版式档案（`PROFILES`）+ `--profile`；**2016 输出逐字节不变**
- [x] 双文件名解析（`parse_audio_name` / `scan_audio`）
- [x] 页眉页码 → 印刷页映射，处理插广告的偏移
- [x] 目录解析兼容「页码在前」，并把正文体续行收进来（不然标题截断成 `The return of the`）
- [x] 结尾花饰按 `ZapfDingbats` 检出（57 个）
- [x] kicker 也能当起点锚（索引标题/音频标题常常指的是 kicker，正文大标题是另一句话）
- [x] 目录没命中时，用音频标题直接配正文锚点；页号靠「mp3 编号与印刷顺序单调一致」插值
- [x] `extend_start`：定位到大标题时往上圈进 kicker/副题，且不越过上一篇的结尾花饰
- [x] 结果：起点定位 55/74，写出 30 篇，**wpm 中位 138**，全部落在 110~175
- [x] 稿子进库：`public/articles.json` 66 篇（2016 的 36 + 2021 的 30），
      App 按文件名精确匹配，两期互不串（文件名写法不同，归一化那一档只在同代次里比）
- [x] `tools/try-extract.py`（无音频也能单测抽取机器）、`tools/inspect-fonts.py`（换期先核对字体）

### 还差什么
- [x] 2021 已写出 30 篇并进了库（`public/articles.json` 现在 66 篇 = 2016 的 36 + 2021 的 30）
- [ ] **3 篇开头是半句话**，抽取脚本会在报告里列出来（`开头疑似半句话`）：
      `007 Leaders Latin America`、`017 Hispanics and QAnon`（这条是误报，原题就是小写 `qAnon`）、
      `084 Art and activism`（`countryDaniel` 粘在一起，副题被截）。
      根因：这些文章的「栏目标签 + 大标题 + 副题」分散在不同栏，
      而正文第一段所在栏在行流里的位置比标题栏更靠前，起点取到标题栏就跟丢了开头。
      → 需要按版面几何（栏 + y）而不是行流下标来定起点。
- [ ] 起点只到 55/74。剩下的多是 `The world this week` / `Letters`（纸面是表格排版），
      以及标题太通用的几篇（`Politics`、`Migration` 会撞车）。
- [ ] 2021 每条音频的标题是**网络版标题**，和纸面索引不完全一样
      （`Literacy` vs 索引 `Reading in America`），所以目录命中只有 26/74，
      另外走的是「音频标题直接配 kicker」那条路。

**验收标准**：正文开头必须是完整一句话（或者干脆是副题那行），不能是半句话。
目前 27/30 达到。

## High Priority

### 用户反馈四项（本轮）
**状态：已做，真机手感待验**

1. **录音发闷 / 声音小** — 发闷的根因是 `noiseSuppression`（Chrome 削高频）。
   录音默认「原声优先」＝关降噪/回声、**保留自动增益**；录音那行加**设备下拉 + 原声/降噪 + 试录 2.5 秒**。
   另外发现「三个全关」会连累连续跟读（小声麦收不到电平 → 读一半就自动停）和回放音量，
   所以把判定阈值改成**自适应**（`max(0.006, 噪声底+0.008)`），并加了**回放响度对齐标准音**
   （`core/loudness.ts` + `core/wav.ts`，缩放到 WAV 播放，不碰 WebAudio 增益链路）。
   换设备（尤其蓝牙耳麦 → 有线/USB）比调参数更有效。
2. **高亮更醒目** — 当前块放大加粗 + 左色条 + 外发光，非当前块压暗。
3. **显示模式（`V`）** — 全文 / 聚焦（当前块大字、邻近压暗）/ 单块，存本机。
   打开「选字定块」会自动切回全文（要跨段拖选）。
4. **手动撕开音频块（`X`）** — 当前块波形，像剪辑软件：点波形从该处试听、可缩放/平移、
   试听长度可调（含到块尾/循环）+ `空格` 播放暂停 + `Enter` 在播放头撕开 + `←→` 微调
   + 合并下一块 + 清除。刀口按音频时间存校准，换粒度/刷新都在。
   第一版把 canvas 缓冲当成了布局尺寸，导致「波形越画越长、把文字也带长」——已改成
   CSS 定显示尺寸、缓冲只做绘制；grid 列也加了 `minmax(0,1fr)`。
   撕开时把原块的手动锚点按比例拆成两个；用户可再用「选字定块」重钉。

- [x] 录音按**音频时间**挂块（`core/takeChunk.ts`）：撕开/换档位后不再串块、A/B 不再放错音
- [x] 导出链接复用 object URL（原来每次渲染泄漏一个，录音时 60fps 放大）
- [x] 录音时重渲染降频（电平节流 25fps）+ 列表计数改 Map/Set 查表
- [x] 撕开不再重跑 VAD（长文章每刀省 ~350ms）
- [x] IndexedDB 建 `fileName` 索引：开文件只取本篇录音，不再 `getAll()` 全库
- [x] 波形按「每像素 min/max」缓存（`useColumns`），播放时不再每帧重扫采样
- [x] 归一化 WAV 缓存加 LRU（`core/lru.ts`，留 8 条）
- [ ] 真机验证：拖刀口/试听、撕开后时间对得上、刷新后刀口还在
- [ ] 真机验证：原声/降噪/换设备确实改变音色（本机没有可用浏览器，只过了单测和 build）
- [ ] 真机验证：连续跟读读满一句不被提前掐断；回放响度和标准音接近
      （`speechRms`/`matchGain`/`floatToWav` 过了单测，但真麦克风下的电平还没验）


### 整体平移（用户实际碰到的问题）
**状态：已做**

用户反馈「文本和音频可能有时间差」。根因：音频不一定念副题，文本整体比音频多一截，
**误差是固定的词数**，按比例摊词修不掉。加了个「文字偏移」手动校准：
`alignTextToChunks(text, chunks, offsetWords)` 把词窗整体平移，
首尾锚在 0/total 所以「拼起来等于原文」不受影响；按篇记住。
UI 上是 `[` `]` 和 ±3/±15 按钮。20 个对齐测试 + 6 个 store 测试守着。
**后来补的**：原来只记在 `SessionStore` 的内存 Map 里，刷新就没了。
现在经 `CalibrationRepoPort` 存 localStorage（`adapters/calibrationRepo.ts`），按篇读回来。

### 标正文起点（用户实际碰到的问题）
**状态：已做**

用户实测：`012 Briefing - The post-truth world` 的正文第一句 `Dishonesty in politics is
nothing new;` 出现在**第 4 块** —— 音频前面有文本里没有的引子。
查过 PDF：那一篇确实就从这句开始（前面只有副题），4188 词 / 1858 秒 = 135 wpm，
和已知正确的那篇一致，**不是抽取抽漏了**，是音频多了一截。

加了「正文从这块开始」（`S` 键）：标了之后只对第 k 块往后摊词，前面的块留空并注明原因。
好处是误差一次清掉，而且摊词区间变成真实朗读区间，后面的漂移也变小。
按篇记住，和整体平移一起存 localStorage。7 个 store 测试守着「拼起来还是原文」「被夹在合法范围」。

### 连续跟读（用户要求）
**状态：已做**

勾上后空格跑一整圈：标准音 →（空档 0.6 秒）→ 录音 → 回放我的录音。
录音中按空格或 `R` 都能提前收尾并回放。手动那条路：`R` 停录后也会自动回放。
（早先是录完跑 `compareAB`「标准 → 我的」，用户要求改成录完直接回放我的。）
自动结束用**电平判定**（说完静几秒算完，默认 2.5 秒、界面上可调）而不是固定时长 ——
固定时长要么掐掉读一半的人，要么让人干等好几秒。兜底上限按录音总时长算（连读时也不会无限录）。
勾选时先摸一次麦克风，权限问题当场暴露。假时钟 + 手动喂电平的单测守着。

- [x] 阈值改成**自适应** `max(0.006, 噪声底+0.008)`（噪声底取见过的最低电平，单调不增），
      不再依赖固定的 `0.06`——USB 麦电平 0.01/0.09 那种也能用
- [x] 「静音多久算读完」默认 2.5 秒并做成可调（1.6/2.5/4/6），读得慢/句中有停顿的人够用
- [x] 录音峰值 < 0.03 时提示「麦克风电平过低」，引导去系统里调增益
- [ ] 真机验证：0.09 峰值、慢速朗读不再被提前掐断
- [ ] 录音首尾的静音没裁：对比时会把开头那 0.6 秒空档和结尾 1.6 秒静音一起放出来。
      `Take` 上加 `speechFrom/speechTo`、`playTake` 支持区间播放就能去掉，但要真机验

### Resync Anchor (用户要求)
**状态：已做（换了入口：鼠标选字，而不是按钮）**

用户最初：『放todo吧』（关于 re-anchor 功能）；后来改主意：原文面板右上角加「选字定块」开关，
鼠标选中文字就等于给当前块打锚点。

- **问题**：文本↔音频是按时长比例摊的（proportional mapping），t=0/t=T 准，中间有峰值误差。
- **症状**：31 分钟 / 89 块的文章，后三分之一可信度差（中位数差 7 词，最大 39 词）。
- **做法**：`core/alignText.ts` 的 `resolveAnchors` + `alignTextToChunksWithAnchors`。
  锚点 = `{ atSec, startWord, endWord, text }`：
  - `atSec` **按音频时间认块**，换切块粒度不失效；
  - `text` 是当时选中的原文，**改别处文字后靠它在新闻表里重新定位**（`findWordSequence`，
    重复短语取离原位最近的），所以分次标记的进度不会因为改文本全废。
  锚点之间的边界按时长比例摊（复用 `alignTextToChunks`），首尾 b[0]/b[N] 锚死，
  所以「拼起来等于原文」仍然成立（有测试）。
- **冲突处理**：同一块只留一个锚点；重叠/乱序的靠前的赢。
- **UI**：`ScriptPanel` 里 DOM 选区 → 字符下标 → 词序号（`pickWords.ts`，纯函数）。
  之前按子节点猜端点，选区落在元素上/段交界时偶尔失效；改成量字符下标后稳了。
- **进度**：按篇存 localStorage，标到一半关掉/刷新都还在，可分批标完。
- **可视化/微调**：边界竖线**插在精确词位**（不是画在整段两端）——
  否则相邻锚点把段边界盖住时，调词号但线不动。配色：已锚定 = 绿粗(起)/红细(终)，
  当前块 = 黄粗(起)/天蓝粗(终)。面板下方有起点/终点 −＋ 按钮，
  快捷键 `,` `.`（起点）、`Shift`+`,` `.`（终点）左右各挪一个词；
  当前块没锚定时按这些键会先按现有对齐钉一个再挪。
  标记 span 里没有文字，所以不影响选字定位的 textContent。
- [x] 单点锚定、后续按比例重新摊开
- [x] 全文 rejoin 正确（多锚点 / 重叠 / 换粒度 / 改文本重定位都测了）
- [x] 开头结尾高亮 + 快捷键微调 + 进度持久化
- [ ] 真机手感待验：鼠标跨段拖选、双击选词、从整段顶部开始拖、绿线标记的观感

### 自动带原文已接进 App
- [x] `core/matchArticle.ts` 三档匹配（精确 → 归一化 → 期号），12 个测试
- [x] `adapters/scriptRepo.ts` 取 `public/articles.json`，一次缓存；取不到当没这功能，不报错
- [x] `load()` 里自动摊到块上，`scriptSource` 区分 auto / manual / none
- [x] UI 标注来源；库里没有时提示「得手动粘」
- [x] 76 个测试通过，`npm run build` 通过

## Medium Priority

### PDF 自动抽取优化
- [x] 用 `EcoPict` 花饰符定位文章终点，替掉「下一篇标题在哪」→ 36/70 篇通过 wpm 闸门，009 相似度 99.7%
- [x] 目录页按「9pt 粗体行数 ≥ 20」识别（不能用「带页码的行占比」，正文页的「Also in this section」交叉引用框会误判）
- [x] 花饰符本身（「7」）和漏进来的图表编号从正文里剔除
- [ ] **34/70 篇仍拿不到原文**，其中多数是「The world this week」和 Lexington / Bello 这类栏目短文，纸面上找不到对应标题。下一条。
- [ ] 目录里根本没这一条：002 Politics、003 Business、051-054（Britain 四个短讯）、077 Building materials。「The world this week」在纸面上是表格排版，标题字体不是 9pt BoldOS，得单独处理。
- [ ] 已被 wpm 闸门拒掉的 25 篇：多数被判「没有自己的结尾标记，终点与下一篇共用」，然后算出语速 40~90 wpm（明显截断）。这批的终点配对还是不对，不是过滤规则的问题。
- [ ] `ALIASES` 手工映射（已处理 7 个：Obamacare / Tweetganda / The NHS / Race relations / Building materials 等），剩下的看上面两条。
- [ ] Leaders 页的 display column（lede）处理目前能工作，但还可以更通用（不只针对包含 size>12 的情况）。

## Low Priority
- [ ] 浏览器端真实环境验证（`getUserMedia`、`MediaRecorder`、seek 精度）：README.md 中 6 项未验证清单
- [ ] 清理端口 5173 的 vite 后台进程（开发时遗留）

---

_最后更新：2026-10-19（数据安全交接见 docs/HANDOFF.md）_