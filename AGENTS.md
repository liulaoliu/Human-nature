# 项目约定（给 AI agent）

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
