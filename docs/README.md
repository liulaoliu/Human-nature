# docs 文档索引

> 按「规范 / 参考 / 记录」组织。开工前至少读：`AGENTS.md` + `ARCHITECTURE.md` + `TESTING.md`。

## 规范（必须遵守）

| 文档 | 用途 |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | 分层、依赖方向、SSOT、新代码放哪里、数据安全铁律 |
| [`TESTING.md`](TESTING.md) | 测试分层、TDD、完成门禁、踩坑清单、人工用例 |
| [`CODE-REVIEW.md`](CODE-REVIEW.md) | Review 触发词（`r` / `r -list` / `r -all`）、A–G 七维度、严重度、修复纪律 |

## 参考

| 文档 | 用途 |
|---|---|
| [`DATA-MODEL.md`](DATA-MODEL.md) | 数据结构与字段口径 |
| [`STORAGE.md`](STORAGE.md) | SQLite 主存 / IndexedDB 兜底、schema、迁移、备份 |
| [`PERF-NOTES.md`](PERF-NOTES.md) | 性能踩坑与约束 |
| [`PIPELINE-PDF.md`](PIPELINE-PDF.md) | PDF 抽取管线 |
| [`PIPELINE-AUDIO.md`](PIPELINE-AUDIO.md) | 音频/跟读管线 |
| [`新特性开发要求.md`](新特性开发要求.md) | 需求原文与早期设计（历史凭证） |
| [`HANDOFF.md`](HANDOFF.md) | 换机 / 交接步骤 |

## 记录

| 文档 | 用途 |
|---|---|
| [`reviews/`](reviews/) | 每次全库/大范围 Review 的发现与重构路线，按日期归档 |

## 根目录文档

- `AGENTS.md`：会话开发约定（工作流、门禁、Review 触发词）。
- `README.md`：用户/开发上手。
- `TODO.md`：待办。
