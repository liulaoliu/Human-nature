# Code Review 规范（触发词 / 维度 / 输出 / 修复纪律）

> 借鉴 `patrol_helper` 的「报词即执行」做法：**用户说一个词，就按固定维度跑完整流程**，不用每次重新约定。
> 本文是流程；具体发现写进 `docs/reviews/`，每次审查一份，按日期归档。

## 一、触发词

| 报词 | 范围 | 产出 |
|---|---|---|
| **`r`** | 当前未提交变更（`git diff` + `git status`） | 按维度审查 diff，给出 P0/P1/P2 + `file:line` + 修法；默认只报不改 |
| **`r -list`** | 当前变更的落点映射 | 先列 A–G 七维度，再按 `git diff --stat` 建议跑哪几维、是否升为 `r` |
| **`r -all`** | 全库 `src/**`、`server/**`、`tools/**`、`docs/**` | 全量现状问题清单 + 重构路线；默认只报不改 |
| **`r 修`** / **`r -all 修`** | 同上 + 允许改代码 | 按 P0→P1 修，每主题单独 commit，跑 `npm run gates` |

单维度也可以点名：`架构 r`、`数据 r`、`测试 r`、`口径 r`、`工程 r`、`UI r`、`安全 r`。

**建议档位**：命中 ≥3 维、或动了共享层（`core/`、`ports`、数据 schema、全局 hook）→ 建议 `r`；
只动 1–2 个面板/样式 → 点名单维；只改文档 → 不跑代码维度。

## 二、母方法（所有维度共用）

1. **先问根因**：这条问题是「实现写错」还是「结构允许它错」？只修表象的，标 P2 并说明。
2. **再查边界**：空值 / 空数组 / 首次运行 / 服务不可用 / 并发写入 / 旧数据 / 超大输入。
3. **最后查口径漂移**：同一个概念是不是有两份实现（日期、类型、打印范围、统计、学习记录 section）。
4. **证据必须可复核**：每条给 `文件:行号` + 代码摘录；子代理给的结论要 `read` 复核后再写进报告。

## 三、七维度与必查点

| 维度 | 范围 | 必查点 | 高信号命令 |
|---|---|---|---|
| **A 架构** | 分层、依赖方向、SSOT、上帝文件、端口/注入 | `types ← core ← adapters ← reader` 是否被打破；`core` 是否碰 React/DOM/存储；同一事实是否只有一个写入方；视图里是否出现领域规则第二份实现；新逻辑是否塞进接近 800 行的文件；端口是否覆盖所有调用（别让 hook 直接 import 具体仓储单例） | `npm run check:arch`、`npm run check:size`、`rg -n "from '.*(reader|adapters|ui|state)" src/core`、`rg -n "useEffect\\(" src/reader` |
| **B 数据** | SQLite / IndexedDB / localStorage / 迁移 / 备份 / 快照 | 迁移是否幂等且与 `user_version` 同事务；写失败是否可见；覆盖前是否留快照；`HybridRepo` 降级后是否永不回头；读接口是否有副作用；导入外部 JSON 是否做运行时校验；备份/合并是否幂等 | `rg -n "user_version|BEGIN|tx\\(" server`、`rg -n "catch \\{\\}" src/adapters`、`rg -n "\\.catch\\(\\(\\) => \\{\\}\\)" src` |
| **C 测试** | 分层、DoD、门禁、测试环境 | 纯逻辑是否有单测；hook/panel 是否有接线测试；新逻辑是否只测了实现细节；测试是否依赖真实 IO；Node 26 下 localStorage 是否用 `installFakeStorage`；新增 core 是否同名测试 | `npm run gates`、`npx vitest run <file>`、`rg -n "localStorage" src --glob '*.test.*'` |
| **D 口径** | 日期键、类型、打印/导出、统计、学习记录 | 日期只用 `core/activity`；词条类型只用 `core/entryKind`；打印范围只用 `core/printPlan`；统计的「今天/连续/累计」是否同源；学习记录 section 前后端是否同一份清单；导出文件名/时间戳是否同一时区口径 | `rg -n "toISOString\\(\\)\\.slice\\(0, ?10\\)" src server`、`rg -n "lastPrintedAt|KIND_ORDER|dayKeyLocal" src/reader` |
| **E 工程** | 并发、性能、容错、时间 | 全局 keydown 是否重复注册/互相抢；timer/订阅是否清理；热路径是否 O(N²)；每次交互是否整库重建；错误是否被 `catch {}` 吞掉；离线/服务重启后是否自愈；AI 轮询是否有上限和取消 | `rg -n "addEventListener\\('keydown'" src`、`rg -n "setInterval|setTimeout" src/reader`、`rg -n "catch \\{\\}" src server` |
| **F UI** | 组件拆分、交互、可访问性、空态/溢出 | 面板是否只收 props；巨型渲染是否拆；键盘操作是否集中；空态/加载/失败三态是否齐全；长文本/窄屏是否溢出；颜色是否走 CSS 变量 | `wc -l src/reader/panels/*`、`rg -n "onClick" src/reader`、`rg -n "aria-|role=|tabIndex" src/reader` |
| **G 安全** | 本地服务、密钥、隐私、发布产物 | 写接口是否校验同源（`/api/store` 之外的 `/api/ai`、`/api/tts`、`/__state` 也要）；密钥是否只从环境/gitignore 文件读；GET 是否暴露整库；DB/备份权限；日志是否打印敏感内容；静态服务路径穿越 | `rg -n "sameOrigin|Origin|apiKey|createReadStream|safeJoin" server tools`、`git check-ignore -v config.local.json data` |

## 四、严重程度

- **P0 致命**：数据丢失/覆盖、崩溃路径、密钥泄露。立即修。
- **P1 严重**：结构允许数据错（双写、无校验导入、静默写失败）、核心层无测试、服务端可被跨站触发。
- **P2 建议**：性能、重复实现、可测性、体验缺口，按性价比排期。
- **P3 小项**：命名、注释、样式、可批量清理。

## 五、输出格式

每次审查写 `docs/reviews/YYYY-MM-DD-<scope>.md`，至少包含：

1. **基线**：commit、门禁结果、测试数、超限文件。
2. **结论**：一句话判断（该拆哪层、别动哪层）。
3. **问题表**：`编号 | 严重度 | 维度 | 文件:行号 | 问题 | 修法`。
4. **重构路线**：按「可单独提交、每步可构建可测」拆阶段，标出验收标准。
5. **人工验证**：自动化覆盖不到的（TTS、打印、真实 SQLite、跨设备备份）列清单。

## 六、修复纪律

- 默认**只报不改**，用户说「修」才动；修的时候先补测试。
- P0/P1 优先；一个主题一个 commit；代码 + 测试 + 文档同批。
- 每批修完跑：定向测试 → `npm run gates`（已含 `server/*.test.js`，它们是 vitest 用例；别再跑 `node --test`）。
- 修「双写」类问题：先合并成**唯一写入口 + 纯计划函数**，不要在两个 effect 之间加锁/加顺序依赖。
- 修「导入/外部 JSON」类问题：先补运行时守卫，再谈字段映射。
- 文档同步：结构变化改 `ARCHITECTURE.md`；测试踩坑改 `TESTING.md` §3；本流程本身变化改本文。

## 七、与日常开发的关系

- 日常小改动走 TDD × 分层（`docs/TESTING.md` §1），**不强制**跑七维全量。
- 发版前、大重构后、换人接手、数据层改动 → 跑一次 `r -all`。
- 审查报告不是「一次性作文」：修完在报告里勾掉，未修的保留为可见债务。
