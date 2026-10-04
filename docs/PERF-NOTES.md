# 性能踩坑记录

> 记录这个项目里**真实踩过**的性能坑，以及修法。每条都有「症状 → 根因 → 修法 → 教训」。
> 这些坑大多集中在精读页（`src/reader/ReaderApp.tsx`），因为它是交互最密、数据最多的地方。

---

## 1. O(N²) 藏在「数题」里：点考试卡 1 秒

- **症状**：点「考试」打开设置面板，要等 ~1 秒才出现；词库越大越久。
- **根因**：设置面板里直接写了一句 JSX：
  ```tsx
  当前范围可出 {buildQuizSet(quizPool).length} 题
  ```
  `buildQuizSet` 要**真的出题**——其中「词形辨析 / 看词选义」会为每个词条挑**形近干扰项**（要遍历整个词库），整体是 **O(N²)**。而这句在**每次渲染**都会跑。
- **修法**：把「大概能出多少题」和「真正出题」分开。新增廉价的 `countQuestions(items, kinds)`（只判断词条够不够出题，O(N)），设置面板用它；`buildQuizSet` 只在**点开始考试**时跑一次。
  - `src/core/quiz.ts: countQuestions`
- **教训**：
  1. **render 里不许放重活**，尤其是"顺带算个数量"。
  2. 计数的复杂度要和生成的复杂度**解耦**。

## 2. O(N × 句子数) 藏在「候选池过滤」里：每次评分都卡

- **症状**：背单词 / 快刷，点一下「认识 / 不认识」卡 ~1 秒；长文章尤其明显。
- **根因**：「本篇」范围的过滤写成了——
  ```ts
  library.items.filter(
    (it) => it.source?.fileName === articleIdentity ||
      doc.sentences.some((s) => wordSpans(s.text).some((w) => lemmaOf(w.text) === it.lemma))
  )
  ```
  对**每个词条**都把**整篇正文重新分词一遍**（`wordSpans` 走 `Intl.Segmenter`），整体 **O(N × 句子数)**。更糟的是：**每次评分都会改词库** → 触发这个 memo 重算。
- **修法**：预计算，把「与文档有关」和「与词库有关」的计算分开：
  - `sentenceLemmas`：每句的 lemma 集合（随 `doc` 变）；
  - `docLemmas`：全文 lemma 集合（随 `sentenceLemmas` 变）；
  - 「本篇」过滤 → `docLemmas.has(it.lemma)`，**O(N)**。
  - `vocabSids`（句子高亮）也改用 `sentenceLemmas`。
  - `src/reader/ReaderApp.tsx`（`sentenceLemmas` / `docLemmas` / `studyPoolFor` / `quizPool` / `vocabSids`）
- **教训**：
  1. **不要对每个条目重扫同一份大集合**——先把大集合索引成 `Set`/`Map`。
  2. 分清楚哪些派生计算**该随文档变**、哪些**该随词库变**；别让「改词库」触发「重扫文档」。

## 3. `import.meta.glob(eager, { query: '?url' })` 会把整目录打进 dist

- **症状**：`dist` 从 5MB 涨到 **49MB**；构建慢。
- **根因**：用
  ```ts
  const FISH = import.meta.glob('.../fish/*.{png,jpg,...}', { eager: true, query: '?url', import: 'default' })
  ```
  取装饰图 URL。`?url` 会把**每个匹配文件**都复制进 `dist/assets`（并哈希）。100 多张图 = 几十 MB。
- **修法**：**当静态资源由服务提供**，前端只拿「文件名清单」：
  - dev：Vite 插件中间件提供 `GET /fish`（清单）与 `GET /fish/<name>`；
  - static：`server/httpApp.js` 同样处理；
  - 前端 `fetch('/fish/manifest.json')` → 随机取一个 → `<img src="/fish/<name>">`。
  - `tools/vite-fish-endpoint.mjs`、`server/httpApp.js`、`src/ui/FishLayer.tsx`
- **教训**：
  1. **`import` 的资源会被打包；要"随便放多少都行"的素材，走静态目录 + 运行时 URL。**
  2. 素材放哪、怎么给，是**构建**问题，不是 **import** 问题。

## 4. 动画 GIF / 大图 吃 CPU

- **症状**：页面整体发滞，尤其某次刷新后一直在动。
- **根因**：装饰图随机命中 **2.9MB 的动画 GIF**，浏览器持续解码 + 合成 → 主线程/合成器忙。
- **修法**：鱼清单**排除 `.gif`**、只收 **≤600KB** 的图（不够再回退）。
  - `tools/vite-fish-endpoint.mjs`、`server/httpApp.js`
- **教训**：装饰性素材要设**体积/格式上限**；动画素材慎用。

## 5. 后台服务跑错工作目录 → 页面全 404（且 status 误报）

- **症状**：服务"在跑"，但 `/reader.html` 全 404；`status.js` 却说"未运行"。
- **根因**：
  - `silent-start.vbs` 把当前目录设成 `server/`，`spawn` 链路**继承**这个 cwd → Vite 的 root 变成 `server/` → 找不到 `index.html`/`reader.html`；
  - `status.js` 在 **dev 模式**探 `/api/status`（那是 **static 模式**才有的接口），所以误报未运行。
- **修法**：
  - spawn 子进程时**显式固定 `cwd = 项目根`**（`silent-start.js` / `watchdog.js` / `watchdog-cli.js`）；
  - `status.js` 在 dev 模式改为**探根路径**兜底。
- **教训**：
  1. **任何后台/守护进程都要显式指定工作目录**，别依赖继承。
  2. 运行状态探测要对**所有运行模式**都成立。

## 6. `autoFocus` 只在首次挂载生效

- **症状**：听写换到第二题起，输入框不聚焦了。
- **根因**：`autoFocus` 是"挂载时聚焦一次"；换题时 React **复用同一个 `<input>`**，不会重新聚焦。
- **修法**：用 `ref` + 监听"换题/检查状态"的 `useEffect` 手动 `focus()`。
  - `src/reader/ReaderApp.tsx`（听写焦点 effect）
- **教训**：需要"每次出现都聚焦"时，**用 ref + effect**，别信 `autoFocus`。

## 7. 声明顺序 / 暂时性死区（TDZ）

- **症状**：某个回调在运行期拿不到最新的 `speak` / `studyCard` / `dictCloze`，或 `useCallback` 的依赖数组里引用了后面才声明的变量 → 报错或拿旧值。
- **根因**：一个大组件里，`useCallback` 的依赖数组在**声明处**求值；若它引用后面才 `const` 的值，就会 TDZ。
- **修法**：用 `ref` 转发（`speakRef`、`dictClozeRef`、`libraryLemmasRef`），或把 hook 重排到依赖之后。
- **教训**：**大组件里 hook 的顺序本身就是一种隐式依赖**——这是往"拆组件/拆 hook"走的强烈信号。

## 8. 随机性写进 render 会抖

- **症状**：填空的挖空词、出题顺序每次渲染都变。
- **根因**：`pickBlankTargets` / `shuffleQuiz` 用 `Math.random()`，若直接写在 render 里，每次渲染结果都不同。
- **修法**：放进 `useMemo`（依赖固定），"一次生成、稳定复用"。
- **教训**：**任何带随机/时间的函数都必须收敛到一次性的派生计算里。**

## 9. 定时器 / 副作用没清理

- **症状**：听写"答对自动下一句"、考试"自动下一句"在退出/切模式后仍触发，出现乱跳。
- **根因**：`setTimeout` 没在 `next/close/切模式/卸载` 时清掉。
- **修法**：统一的 `clearAdvance()`，在相关入口都调用，并在卸载 effect 里兜底。
- **教训**：**每个定时器都要有明确的"谁负责清理"。**

## 10. 数据放哪，是有讲究的

- **词库 / 录音** → **IndexedDB**（大数据、异步、不能塞进 localStorage）。
- **偏好 / 统计 / 草稿 / 错题本** → **localStorage**（小、同步读、首屏要用）。
- **IndexedDB 按 origin 隔离** → 端口一变（origin 变）数据就"看不见"了。所以服务**端口锁死 5173**。
- **教训**：先想清楚"这份数据多大、谁读、要不要首屏同步拿"，再选存储。

---

## 一句话总结

> **交互热路径上，绝不允许出现随「词库规模 × 文档规模」增长的计算；派生计算要分层（随文档变 / 随词库变），大集合先索引成 `Set`/`Map`；重资产走静态服务，不进 bundle。**

（后续若再出现卡顿，排查顺序：① 打开 DevTools Performance 录一段，看长任务在哪；② 全局搜 `render 里调用的函数` / `.some(` / `.filter(` 嵌在 `map` 里 / `import.meta.glob`。）
