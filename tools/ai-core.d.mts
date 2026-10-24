/**
 * tools/ai-core.mjs 的最小类型声明（规范 §3：只声明 server 实际用到的导出）。
 *
 * 不复制整个实现，不迁这个脚本本体（规范 §1「不在范围内」）。server 只用到
 * `handleAiApi`；`.mjs` 内部的所有逻辑、key 读取、模型调用都不在这里声明。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

export function handleAiApi(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { root: string },
): void
