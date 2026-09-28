# TODO

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

### 整体平移（用户实际碰到的问题）
**状态：已做**

用户反馈「文本和音频可能有时间差」。根因：音频不一定念副题，文本整体比音频多一截，
**误差是固定的词数**，按比例摊词修不掉。加了个「文字偏移」手动校准：
`alignTextToChunks(text, chunks, offsetWords)` 把词窗整体平移，
首尾锚在 0/total 所以「拼起来等于原文」不受影响；按篇记住（`SessionStore.offsets`）。
UI 上是 `[` `]` 和 ±3/±15 按钮。20 个对齐测试 + 6 个 store 测试守着。

### 标正文起点（用户实际碰到的问题）
**状态：已做**

用户实测：`012 Briefing - The post-truth world` 的正文第一句 `Dishonesty in politics is
nothing new;` 出现在**第 4 块** —— 音频前面有文本里没有的引子。
查过 PDF：那一篇确实就从这句开始（前面只有副题），4188 词 / 1858 秒 = 135 wpm，
和已知正确的那篇一致，**不是抽取抽漏了**，是音频多了一截。

加了「正文从这块开始」（`S` 键）：标了之后只对第 k 块往后摊词，前面的块留空并注明原因。
好处是误差一次清掉，而且摊词区间变成真实朗读区间，后面的漂移也变小。
按篇记住（`SessionStore.starts`）。7 个 store 测试守着「拼起来还是原文」「被夹在合法范围」。

### 连续跟读（用户要求）
**状态：已做**

勾上后空格跑一整圈：标准音 →（空档 0.6 秒）→ 录音 → 对比。
复用现成的 `stopRecording` / `compareAB`，手动那条路没动。
自动结束用**电平判定**（说完静 1.6 秒）而不是固定时长 —— 固定时长要么掐掉
读一半的人，要么让人干等好几秒。兜底上限按录音总时长算（连读时也不会无限录）。
勾选时先摸一次麦克风，权限问题当场暴露。12 个测试（假时钟 + 手动喂电平）。

- [ ] 阈值 `VOICE_LEVEL = 0.06` / `VOICE_HANGOVER_MS = 1600` 是拍的，只有真麦克风能校准
- [ ] 录音首尾的静音没裁：对比时会把开头那 0.6 秒空档和结尾 1.6 秒静音一起放出来。
      `Take` 上加 `speechFrom/speechTo`、`playTake` 支持区间播放就能去掉，但要真机验

### Resync Anchor (用户要求)
**状态：待办（比上面那个更细：任意一块重锚，修「越往后越差」）**

用户：『放todo吧』（关于 re-anchor 功能）

- **问题**：当前的文本↔音频映射是按时长比例做的（proportional mapping）。这种做法保证 t=0 和 t=T 零误差，但在中间会有峰值误差。
- **症状**：在一篇 31 分钟、89 个 chunk 的文章中，后三分之一的 chunk 的词序/边界可信度不高（已观察到 wall-clock vs speech-clock 的不一致：中位数 7 词，最大 39 词）。
- **需求**：允许用户在任意一个 chunk 上重新锚定（re-anchor）。一旦用户确认某个 chunk 的正确边界/对应文字，**之后的所有 chunk 都要基于这个新锚点重新重新分配（re-spread）**。
- **实现思路（简单版）**：
  - [ ] 在 UI 上为每个 chunk 增加「重新锚定」（Re-anchor）按钮
  - [ ] 当用户点击某个 chunk k，记下 `anchorIndex = k`，`anchorTime = chunk.k.endTime`（或播放当前位置），`anchorWord = aligned[k].endWordIndex`
  - [ ] 重新计算 k+1..N 的 chunk 边界：从 anchor 点开始，按剩余时长和剩余词数做**比例分配**，而不是从头重算全篇
  - [ ] 更新 `SessionStore.aligned`（或 `script` 映射），保持单词总数不变（rejoin 必须仍然正确）
  - [ ] 预计代码 ~10 行核心逻辑 + 按钮 UI
  - [ ] 测试：在中间某个 chunk 纠正后，后续 chunk 的偏移应该明显改善，不影响前面 chunk

**理由**：比例映射没有自我修正能力。加一个单点锚定点，就能把累积误差局限在 anchor 点之后的区间内。

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

_最后更新：2025-09-28_