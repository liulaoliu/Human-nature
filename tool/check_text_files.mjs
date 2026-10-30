// ============================================================
// check_text_files.mjs — 源码必须是「纯文本」门禁
//
// 为什么需要：`useGoldenImitation.ts` 里曾经写了一个**真实的 NUL 字节**
// （`[a, b].join('^@')`，本意是 `join('\u0000')`）。JS 认它，运行时也没事，
// 但 git 会把整个文件判定为二进制：
//   - `git diff` 只显示 `Bin 5275 -> 8478 bytes`，**这文件的改动再也 review 不了**；
//   - `git blame` / 冲突合并 / 代码检索工具全部降级；
//   - 编辑器可能把它当二进制打开，改坏都没提示。
// 这类字节肉眼看不见（`^@`），只能靠门禁抓。
//
// 规则：`src` / `server` / `tools` / `tool` / `docs` 下的源码与文档必须是
// **合法 UTF-8 且不含 NUL**。命中了就失败，并打印文件 + 行号 + 修法。
//
// 用法：node tool/check_text_files.mjs        （退出码 0 通过 / 1 违规）
// ============================================================
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOTS = ['src', 'server', 'tools', 'tool', 'docs']
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'public', 'build', 'data'])
const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|css|md|json|html)$/

/**
 * 体检一批「文件 + 原始字节」，返回违规清单（纯函数，方便单测）。
 *
 * @param {{ file: string, bytes: Uint8Array }[]} entries
 * @returns {{ violations: string[] }}
 */
export function auditTextFiles(entries) {
  const violations = []
  for (const { file, bytes } of entries) {
    const nul = indexOfNul(bytes)
    if (nul >= 0) {
      violations.push(
        `${file}:${lineOf(bytes, nul)} 含 NUL 字节（\\0）。git 会把整个文件当二进制，diff / review 全部失效。` +
          `如果是要拼分隔符，写成 '\\u0000' 转义串，别写字面量。`,
      )
      continue
    }
    if (!isValidUtf8(bytes)) violations.push(`${file} 不是合法 UTF-8（可能被存成了 GBK / 二进制）。`)
  }
  return { violations }
}

function indexOfNul(bytes) {
  for (let i = 0; i < bytes.length; i += 1) if (bytes[i] === 0) return i
  return -1
}

function lineOf(bytes, index) {
  let line = 1
  for (let i = 0; i < index; i += 1) if (bytes[i] === 0x0a) line += 1
  return line
}

function isValidUtf8(bytes) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

function collect(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) collect(p, out)
    } else if (TEXT_EXT.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

function main() {
  const root = process.cwd()
  const files = ROOTS.filter((d) => {
    try {
      readdirSync(d)
      return true
    } catch {
      return false
    }
  }).flatMap((d) => collect(d))
  const entries = files.map((f) => ({
    file: relative(root, f).split('\\').join('/'),
    bytes: readFileSync(f),
  }))
  const { violations } = auditTextFiles(entries)
  if (violations.length) {
    for (const v of violations) console.error(`❌ ${v}`)
    console.error(`\n[text] 失败：${violations.length} 个文件不是纯文本。`)
    process.exit(1)
  }
  console.log(`✅ 纯文本门禁通过（${entries.length} 个文件，无 NUL、合法 UTF-8）`)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
