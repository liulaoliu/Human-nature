/**
 * tools/tts-core.mjs 的最小类型声明（规范 §3：只声明 server 实际用到的导出）。
 *
 * 不复制整个实现，不迁这个脚本本体（规范 §1「不在范围内」）。server 只用到
 * `handleTts`（返回 Promise，httpApp 里 `.catch` 了）与 `resolveTtsCacheDir`。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

export function handleTts(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { cacheDir: string },
): Promise<void>

export function resolveTtsCacheDir(root: string): string
