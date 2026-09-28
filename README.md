# 跟读练习（shadowing）

拿一篇文章的音频，切成一块一块（约一句），**听标准音 → 跟读录音 → 标准/我的交替对比**。
带原文对照：当前这块读到哪，用大字高亮出来。

做成工具是为了省掉「拖进度条、按暂停、找刚才那句」这些动作——一块一块地过，不用管播放位置。

## 先看这一条：强相关于 The Economist

这个项目**不是通用的跟读软件**，它是围着 The Economist 的杂志 PDF 和配套音频做的：

| 环节 | 依赖 Economist 的什么 |
|---|---|
| 原文来源 | 从**杂志 PDF** 抽正文。靠字体名（`OfficinaSanITC-BoldOS`、`MiloLNTE-Bold`…）和版式定位，换一家刊物就得重写 |
| 音频切块 | 只依赖音量，**这部分是通用的**（任何 mp3 都能切） |
| 原文 ↔ 音频对应 | 靠「正文文件名的期号」和「朗读语速约 135 wpm」这两条经验。换个语速差异大的来源就不准 |

已实测两期，版式完全不同，各自一套「版式档案」（见 `docs/PIPELINE-PDF.md`）：

| | 2016-09-10 | 2021-06-12 |
|---|---|---|
| 正文 / 标题字体 | `EcoNewtext-Roman` / `OfficinaSanITC-BoldOS` | `MiloTE` / `MiloLNTE-Bold` |
| 文章结尾标记 | `EcoPict-Two`（花饰符 `7`） | `ZapfDingbatsITCTT`（`\x81`） |
| 音频文件名 | `009 Leaders - Interest-rate caps.mp3` | `005-Leaders---The-green-boom-<哈希>.mp3` |
| 抽出来的篇数 | 36 / 70 | 30 / 74 |

**换一期（甚至换一期里的某一篇）都要先核对字体**，步骤见 `docs/PIPELINE-PDF.md`。
抽不出来时会**一篇都不写**，App 退回手动粘原文——不会给你看着能用、实际串篇的文本。

音频文件一个都不在仓库里，杂志 PDF 也不在。**原文库（`public/articles.json`）同样不进仓库**
（它是从杂志抽出来的正文，有版权），需要时本地跑一遍抽取生成。

## 跑起来

```
npm install
npm run dev
```

打开终端里给的 `http://localhost:5173`，选一个 mp3。

**必须走 `http://localhost`，不要双击 `dist/index.html`。** 浏览器的 `file://` 页面拿不到麦克风权限，
`public/articles.json` 也读不到（`fetch` 被拦）。构建产物要用 `npm run preview` 打开。

## 按键

| 键 | 作用 |
|---|---|
| `空格` | 播放/暂停当前块（标准音）。暂停后是**接着播**，不是从头 |
| `R` | 开始/停止录音（手动那条路，任何时候都可用） |
| `↑` `↓` | 上一块 / 下一块，**并像按空格一样直接跑**（没开连续跟读就是播标准音） |
| `C` | 标准 → 我的，对比一遍 |
| `T` | 打开/收起原文输入框 |
| `S` | 把「正文真正的开头」锚到当前块（按篇记住） |
| `[` `]` | 文字偏移校准 −3 / +3 词（加 `Shift` 是 ±15，按篇记住） |

界面上的「切块」三档改的是分块的合并间隔：短 150ms / 中 400ms / 长 700ms。
默认「中」，在 Economist 音频上约 5.4 秒一块（约 14 个词，接近一句）。「语速」是播放速度。

### 连续跟读（可选，勾了才生效）

勾上之后空格不再只是播标准音，而是跑完一圈：

```
标准音 →（空档 0.6 秒）→ 录音 → 说完停 1.6 秒自动结束 → 回放我的录音
```

一圈只按一次空格。录完直接回放「我的」，想再和外音对照按 `C`。
细节和判定阈值见 `docs/PIPELINE-AUDIO.md`。
**不勾时手动那条路完全不变**：`R` 只管录音，空格只管播放/暂停。

录音只保留**每一块最新的一条**（同一块再录就顶掉旧的），存浏览器 IndexedDB 里，关页面不丢。
不堆历史是因为它只用来「录完马上复读」，不需要留档。
手动对齐校准（`S` 正文起点、`[` `]` 文字偏移）按篇存在 localStorage 里，刷新页面也还在。
分块结果不存（每次打开重跑一次 VAD，100ms 的事）。

## 两条核心链路

| 文档 | 管什么 |
|---|---|
| [`docs/PIPELINE-PDF.md`](docs/PIPELINE-PDF.md) | 杂志 PDF → 每篇文章的正文 → `public/articles.json`。版式档案、质量闸门、换期步骤 |
| [`docs/PIPELINE-AUDIO.md`](docs/PIPELINE-AUDIO.md) | 音频 → 分块 → 和原文对应（**近似**）→ 怎么手动校准、误差从哪来 |

设计取舍（为什么砍掉一半功能、哪些是有意不做的）在 [`DESIGN.md`](DESIGN.md)。
没做完的和已知问题在 [`TODO.md`](TODO.md)。

## 结构

```
src/
  core/            无 DOM 依赖的纯逻辑 + 测试
    vad.ts           能量法 VAD，把音频切成块
    alignText.ts     文本按块时长比例摊开 + 句末吸附 + 整体平移
    matchArticle.ts  按音频文件名找配套原文
    ports.ts         Model 层的接口边界
  state/
    session.ts       ViewModel，不依赖 React，可以直接单测
  adapters/
    browserAudio.ts  AudioPlayerPort / RecorderPort 的浏览器实现
    takeRepo.ts      IndexedDB 持久化（录音，每块只留最新一条）
    calibrationRepo.ts  localStorage 持久化（文字偏移 / 正文起点）
    scriptRepo.ts    取 public/articles.json
  ui/               View，React 组件
tools/              构建期脚本（Python，运行时不需要）
  inspect-fonts.py     换期第一件事：核对字体命中了哪套版式档案
  extract-articles.py  从 PDF 抽正文，带 wpm 质量闸门
  validate-articles.py 单独跑质量闸门
  try-extract.py       没有音频时也能单测抽取机器
```

依赖倒置的方向：React → `SessionStore` → `ports.ts` → `adapters/`。
测试时把适配器换成假的，所以「播到块尾自动停」「A/B 的先后顺序」「连续跟读整圈」
这类最容易出 bug 又最难手动测的逻辑，不用开浏览器就能断言。

## 测试

```
npm test          # 129 个（没生成 public/articles.json 时是 124 个 + 5 个跳过，一样是绿的）
npm run build     # tsc -b && vite build
```

`src/core/articles.test.ts` 会拿真的 `public/articles.json` 验「每条键都能用自己的文件名查回来」——
这条是为了防止以后重新抽取时键名和音频文件名对不上、App 静默退化成手动粘。
那份文件不在仓库里（见上），所以它用 `import.meta.glob` 探测，**没有就整组跳过，不会因为缺数据让测试红**。

## 还没验证的部分

**真浏览器上的麦克风相关行为没有验证过**（写这个的会话里没有可用的浏览器）。
自动带原文和分块已经实测过，剩下这些需要手动确认：

- [ ] 点「标准音」在块尾停住，没有多吃下一个字
- [ ] 点录音，电平表有反应，停止后录音出现在列表里
- [ ] 「标准 → 我的」顺序正确，我的录音能正常播放
- [ ] 勾上「连续跟读」，说完会自动停并进对比
- [ ] 刷新页面后录音还在

如果录音没反应：先确认是 `http://localhost` 而不是 `file://`，再确认地址栏左侧没显示"不安全"。
只在 Chrome / Edge / Firefox 上试过，Safari 的行为不确定。
