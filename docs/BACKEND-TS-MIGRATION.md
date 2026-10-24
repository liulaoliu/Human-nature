# 后端 TypeScript 渐进迁移规范（交办版）

> 状态：**提案，未执行**。这是给另一个 agent 的施工规范，不是“参考建议”。
> 结论先写在最前面：**不建议一次性把 4.8k 行后端重写成 TS**；
> 值得做的是**按文件渐进迁移 + 严格类型门禁**。如果不接受下面的硬约束，就不要开工。

---

## 0. 为什么做 / 为什么不整体重写

### 值得做的理由

- `server/**` 约 **28 个文件 / 4.8k 行**，承担 SQLite 词库、文章、学习记录、备份、同源校验、
  静态服务、watchdog 等数据关键逻辑；现在只有测试，没有静态类型。
- 前端类型在 `src/types/document.ts`，后端大量 `JSON.parse` / SQLite row 直接当对象用，
  字段漂移只能靠测试发现。
- 新增后端功能时，TS 能在编译期拦住“字段改名 / 可空 / 路由参数”这类错误。

### 不建议整体重写的理由

- 后端已经稳定运行，且有 `server/*.test.js` 覆盖；一次性重写是**高风险、低即时收益**。
- 迁移会动启动链路（`启动服务.cmd`、`silent-start.vbs`、systemd、watchdog、PID 文件），
  任何一处漏改，用户看到的是“服务起不来”，不是类型错误。
- 真正有价值的是**渐进 + 门禁**，不是“全部 .ts”这个形态。

**执行策略：一次只迁移一个文件；行为零变化；每一步都能回滚。**

---

## 1. 范围

### 在范围内

- `server/**/*.js` 的生产代码（28 个文件，约 4.8k 行）。
- 所有 import 到这些文件的地方：
  - `server/*.test.js`（只改 import 扩展名，不强制迁测试）
  - `tools/vite-ai-endpoint.mjs`、`tools/vite-store-endpoint.mjs`
  - `vite.config.ts`
  - `package.json` scripts
  - `启动服务.cmd`、`停止服务.cmd`、`server/silent-start.vbs`
  - `server/shadowing-reader.service.template`
  - `README.md` / `docs/PERF-NOTES.md` 里过期的路径
- 为 `tools/ai-core.mjs`、`tools/tts-core.mjs` 补 **只读 `.d.ts`**（不迁移这两个脚本本体）。

### 不在范围内（禁止顺手做）

- `tools/ai-pack.mjs`、`ai-agent.mjs`、`tts-local.mjs`、`build-*.mjs` 等 CLI 脚本。
- 前端 `src/**`（除了类型复用需要的 `import type`）。
- 数据库 schema、`SCHEMA_VERSION`、迁移顺序、数据文件格式。
- 任何 HTTP 路由、状态码、响应字段、错误文案、header、CSP、同源规则。
- 功能重构、重命名、目录搬迁、依赖升级。
- 把 `server` 改成 CommonJS、加 `tsx` / `ts-node` / `dist-server` 构建。

---

## 1.5 文件删除安全（不要依赖 WorkBuddy 注入）

迁移会大量改文件名，**删除安全必须靠流程，不靠“把 rm 换成回收站”的进程注入**。

- 迁移只允许 `git mv server/foo.js server/foo.ts`；删除只允许 `git rm`。
  禁止 `rm`、`del`、`Remove-Item`、`git clean`、`git reset --hard`、`robocopy /MIR`。
- 每个 commit 前必须看：
  ```bash
  git status --short
  git diff --name-status HEAD
  ```
  除了预期的 `M` / `R`，出现 `D` 就要停下来解释。
- WorkBuddy 注入到 Node 进程只能覆盖**该 Node 进程内的 fs 调用**；
  覆盖不了 Git Bash 的 `rm.exe`、cmd 的 `del`、`git clean`、绝对路径调用、其他进程。
  如果注入靠当前终端的 `NODE_OPTIONS` / shell hook，关掉终端后新进程不会继承，
  这正是“terminal 关掉可能失效”的原因；不要把它当成迁移的安全保障。
- 删除未跟踪文件（构建产物、临时文件）必须用 `node-safe-delete` / 回收站，
  且按项目约定 ≤40 个一批；或者先移动到 `I:/.cache/temp/opencode/trash-*`。
- 真正可恢复的是 **Git 历史 + 外部备份**，不是回收站。

## 2. 运行时方案（必须二选一，不许混用）

### 方案 A（默认，采用这个）：Node 原生 type stripping

- 目标 Node：**>= 23.6**（本机 Node 26.4 已验证可直接 `node x.ts`）。
- 不生成 `dist-server`，不引入 `tsx` / `ts-node`。
- 所有相对 import 必须写 **显式 `.ts` 扩展名**，例如：
  ```ts
  import { openStore } from './sqliteStore.ts'
  ```
- `package.json` 增加：
  ```json
  "engines": { "node": ">=23.6" }
  ```
- 启动入口加一个版本守卫（`appServer.ts` 最合适）：
  ```ts
  const major = Number(process.versions.node.split('.')[0])
  const minor = Number(process.versions.node.split('.')[1] ?? 0)
  if (major < 23 || (major === 23 && minor < 6)) {
    console.error('需要 Node >= 23.6（原生 TypeScript type stripping）')
    process.exit(1)
  }
  ```
- 只允许 **erasable syntax**：`enum` / `namespace` / 参数属性 / `import =` / `export =`
  一律禁用；用 `const` 对象 + union 替代。

### 方案 B（仅当产品必须支持 Node 22 LTS 才考虑）

- 用 `tsx` 运行，或在 `tsc` 里 emit 到 `dist-server/`。
- **不要在没有改这份 spec 的情况下自己切到方案 B。**
- 如果必须选 B，先停止施工，回到用户确认；方案 B 需要额外改启动脚本、构建产物和 `.gitignore`。

---

## 3. 新增的 TypeScript 配置

新增 `tsconfig.server.json`（不要改现有 `tsconfig.json` 的 `include`）：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["server/**/*.ts", "tools/*.d.ts"]
}
```

要求：

- `@types/node` 加进 `devDependencies`；不要加任何运行时依赖。
- 如果 `@types/node` 没有 `node:sqlite` 类型，才允许新增
  `server/types/node-sqlite.d.ts`；声明里用 `unknown`，**不许写 `any`**。
- `tools/ai-core.d.ts` / `tools/tts-core.d.ts` 只声明 server 实际用到的导出
  （`handleAiApi` / `handleTts` / `resolveTtsCacheDir`），不要复制整个实现。
- 前端 `tsc -b` 仍然只跑 `src` + `vite.config.ts`；不要把一个 `server/**` glob 塞进主 tsconfig。

---

## 4. 类型纪律（违反即打回）

### 4.1 禁止

- `any`、`as any`、`as unknown as`（除非是已写测试的 JSON 边界守卫，且只用一次）。
- `@ts-ignore`、`@ts-nocheck`、`@ts-expect-error`
  （唯一例外：第三方缺类型且已加 `.d.ts` 仍无法表达；必须在行内写原因 + 限制范围）。
- `!` 非空断言，除非上一行刚刚做了运行时判空。
- `Object`、`Function`、`{}` 作为类型；用具体形状 / `unknown`。
- 把 `JSON.parse(...)` 的结果直接 `as SomeType`。
- 为了让编译过而删测试、改断言、放宽 `strict`。
- 把错误用 `catch {}` 吞掉；`catch (e)` 一律 `unknown` + `instanceof Error` 收窄。

### 4.2 外部输入必须过守卫

以下入口一律先得到 `unknown`，再用具名 guard / parser 收窄：

- `JSON.parse`：HTTP body、`/vocab`、文章、备份、配置。
- SQLite：`stmt.get()` / `stmt.all()` 的 row。
- `process.env`：必须 `parseInt` / 白名单校验，不许直接当 `string`。
- HTTP header：`req.headers.origin` 等是 `string | string[] | undefined`，先收窄。

守卫函数放在**被使用的模块**或 `server/types/guards.ts`，并配单测；
返回“好数据 + 丢弃原因/条数”时，不能静默把坏数据变成空库。

### 4.3 共享类型

- 前端已有纯类型（`VocabLibrary`、`SavedArticle`、`Sentence`、学习记录）：
  用 `import type { ... } from '../src/types/document.ts'`。
- **只允许 `import type`**；不要在 server 运行时 import 前端模块。
- 如果发现 `src/types` 里有运行时值被后端需要，停下来报告，不要复制第二份类型。

### 4.4 注释

- 类型断言、`unknown` 收窄、兼容旧数据的地方必须有中文注释说明“为什么”。
- 不要写“TS 要求所以断言”这种废话；写清楚数据来源和失败时的行为。

---

## 5. 施工顺序（一次一个文件，一次一个 commit）

按依赖从叶子到入口；**不要并行改多个生产文件**。

1. `localDate.js`
2. `privatePaths.js`（同时改 `vite.config.ts` 的 import 和 `@ts-expect-error`）
3. `util.js`
4. `sameOrigin.js`（同时改 `tools/vite-ai-endpoint.mjs`）
5. `sqliteSchema.js`
6. `sqliteUtil.js`
7. `sqliteVocab.js`
8. `sqliteProjection.js`
9. `sqliteLearningSections.js`
10. `sqliteLearningWrite.js`
11. `sqliteLearning.js`
12. `sqliteBackup.js`
13. `sqliteStore.js`（最大、数据最关键，单独 commit）
14. `storeApi.js`（同时改 `tools/vite-store-endpoint.mjs`）
15. `httpApp.js`
16. `appServer.js`
17. `mode.js`
18. `watchdog.js`
19. `watchdog-cli.js`
20. `silent-start.js`
21. `status.js`
22. `stop.js`

每步只做：

1. 先跑一次 `npm run gates`（基线）。
2. `git mv server/foo.js server/foo.ts`。
3. 改所有 import 到 `foo.ts`（用 `rg "foo\\.js"`，不要全仓替换 `.js`）。
4. 加类型；跑 `npm run typecheck:server`。
5. 改对应 `.test.js` 的 import 扩展名；跑该测试文件。
6. 跑 `npm run gates:server`。
7. commit：`refactor(server): 迁移 foo 到 TypeScript（零行为变化）`。

如果某文件类型错误超过 **30 分钟** 或需要改行为才能过：
**撤销该文件，记录阻塞点，不要硬塞 `any` 过关。**

---

## 6. 启动链路必须同步改（漏一个就是服务起不来）

这些不是“顺手”：它们是迁移的一部分，必须在对应入口文件迁移的同一个 commit 里改。

| 位置 | 改成 |
|---|---|
| `package.json` `serve` | `node server/appServer.ts` |
| `package.json` `app` | `npm run build && node server/appServer.ts` |
| `启动服务.cmd` | `node server/status.ts` / `node server/silent-start.ts` |
| `停止服务.cmd` | `node server/stop.ts` / `node server/status.ts` |
| `server/silent-start.vbs` | `node silent-start.ts` |
| `server/mode.js` | `appServer.ts` |
| `server/silent-start.js` | `watchdog-cli.ts` |
| `server/watchdog-cli.js` | import `.ts` |
| `server/shadowing-reader.service.template` | `watchdog-cli.ts` |
| `server/server.test.js` | 断言 `appServer.ts`（不要再断言 `.js`） |
| `README.md` / `docs/PERF-NOTES.md` | 过期路径 |

**绝对不能动**：

- `server/util.js` 里的 MIME 表（`.js` 是 HTTP Content-Type，不是模块路径）。
- PID 文件名、端口、`dist/` 路径、`data/` 路径、`config.local.json` 路径。
- `node server/status.js` 这类旧命令可以保留兼容包装，但必须在 README 里写清楚推荐命令。

---

## 7. 测试与门禁

### 7.1 新增脚本

```json
"typecheck:server": "tsc -p tsconfig.server.json"
```

并改：

```json
"gates:server": "npm run typecheck:server && vitest run server tools --pool=forks --maxWorkers=4 --minWorkers=1",
"gates": "tsc -b && npm run typecheck:server && vitest run && npm run gates:static",
"gates:fast": "tsc -b && npm run typecheck:server && node tool/test_changed.mjs && npm run gates:static"
```

### 7.2 测试策略

- `server/*.test.js` 可以先保留 JS；只把 import 改成 `.ts`，Vitest 能直接跑。
- 不要求把测试迁成 TS；如果顺手迁，必须单独 commit，不许和 production 文件混。
- 每个迁移文件必须保留同名测试；没有测试的模块先补 characterization test 再迁。
- 测试数量不得减少；原有断言不得放宽。

### 7.3 全量验收

```bash
npm run typecheck:server
npm run gates:server
npm run gates
npm run check:dev
```

另外（构建后）：

```bash
npm run app
```

手工冒烟：

| 请求 | 期望 |
|---|---|
| `GET /api/status` | 200 JSON |
| `GET /api/store/health` | 200 JSON |
| `GET /api/ai/status` | 200，不返回 key |
| `GET /api/tts/engines` | 200 JSON |
| `GET /reader` | 200 text/html |
| `GET /config.local.json` | 404 |
| `GET /assets/不存在的.js` | 404，不能回落 HTML |

Windows 还要实际跑一次 `启动服务.cmd` / `停止服务.cmd`；
Linux 只做 `server/shadowing-reader.service.template` 的静态检查，不在本机跑 systemd。

---

## 8. 明确禁止的“瞎搞”清单

1. 一次性 `git mv server/*.js server/*.ts` 全量重命名。
2. 全仓搜索替换 `.js`（会改坏 MIME 表、前端资源名、测试里的扩展名断言）。
3. 为了过编译加 `any` / `as any` / `@ts-ignore` / `@ts-nocheck`。
4. 改 `SCHEMA_VERSION`、迁移顺序、数据库列名、JSON 字段名。
5. 改 HTTP 状态码 / 响应字段 / 错误文案 / header / 同源规则。
6. 改启动方式（`tsx` / `dist-server` / CommonJS）而不改这份 spec。
7. 把 `tools/*.mjs` 一起迁了（除了 `.d.ts`）。
8. 改测试断言来迁就代码；行为测试红了就回滚。
9. 把 `tools/ai-core.mjs` / `tools/tts-core.mjs` 重命名或改写。
10. 在一个 commit 里混“迁移 + 新功能 + 格式化”。
11. 引入新的运行时依赖（`@types/node` 是 devDependency，允许）。
12. 删除旧 `.js` 文件前不跑 `npm run gates`。
13. 在迁移期间改 `.gitignore` / 数据文件 / `config.local.json`。
14. 把 `console.log` 静默掉或改日志格式；测试和排障依赖它们。
15. 把 `process.exit` / PID 文件 / watchdog 重启逻辑改成 async 或换语义。

---

## 9. 交付物 Checklist

- [ ] `server/**` 生产代码全部 `.ts`，没有遗留 `.js` 生产文件。
- [ ] `tsconfig.server.json` 存在，`typecheck:server` 0 error。
- [ ] `@types/node` 在 devDependencies；无运行时新依赖。
- [ ] `tools/ai-core.d.ts` / `tools/tts-core.d.ts` 存在且最小化。
- [ ] 所有相对 import 带 `.ts`；没有 `.js` 生产 import。
- [ ] `package.json` / `.cmd` / `.vbs` / systemd 模板 / README 全部同步。
- [ ] `server/util.js` 的 MIME `.js` 没被误改。
- [ ] `npm run gates` 绿；测试文件数 / 用例数不少于迁移前。
- [ ] `npm run check:dev` 绿。
- [ ] `npm run app` 能启动；冒烟表全过。
- [ ] 每个文件一个 commit；message 以 `refactor(server):` 开头，注明“零行为变化”。
- [ ] 迁移前后各存一份 `git diff --stat` + 测试汇总，交给用户复核。

---

## 10. 回滚

- 任一阶段红灯：`git revert <该文件 commit>`，不要“再改改看”。
- 如果启动链路已改但服务起不来：先回滚对应的启动脚本 commit，再排查。
- 不允许用“临时注释掉 watchdog / 跳过测试”换绿。

---

## 11. 给施工 agent 的开工提示（可直接粘贴）

```text
你负责按 docs/BACKEND-TS-MIGRATION.md 迁移 server/** 到 TypeScript。
先完整读这份 spec，再执行；任何一条硬约束不满足就停下来报告，不要自己改方案。
默认方案是 Node >=23.6 原生 type stripping；不要引入 tsx/ts-node/dist-server。
一次只迁移一个文件，一个 commit；行为零变化；每步跑 npm run gates:server。
禁止 any / as any / @ts-ignore / @ts-nocheck；外部输入必须先 unknown + 守卫。
不要全仓替换 .js；server/util.js 的 MIME 表不能动。
启动脚本、.cmd/.vbs、systemd 模板、README 与入口文件同一个 commit 改。
先给我一份迁移清单和第一文件的计划，再开始改代码。
```
