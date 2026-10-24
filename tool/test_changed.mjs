#!/usr/bin/env node
/**
 * 快速门禁：只跑「改动文件对应的同名测试」。
 *
 * 不是替代全量门禁：共享 core / 类型改动可能影响 import 方，提交前仍要跑
 * `npm run gates`。这里的目标是开发循环里几秒内拿到反馈，别每改一行就等全量。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const git = (args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8' })
      .split('\0')
      .filter(Boolean)
  } catch {
    return []
  }
}

const changed = [
  ...git(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD', '-z']),
  ...git(['ls-files', '--others', '--exclude-standard', '-z']),
]
const files = [...new Set(changed)].filter((f) => existsSync(f))
const isTest = (f) => /\.test\.(ts|tsx|js|mjs)$/.test(f)
const isCode = (f) => /\.(ts|tsx|js|mjs)$/.test(f)

const tests = new Set(files.filter(isTest))
for (const f of files) {
  if (isTest(f) || !isCode(f)) continue
  const base = f.replace(/\.(ts|tsx|js|mjs)$/, '')
  for (const ext of ['.test.ts', '.test.tsx', '.test.js', '.test.mjs']) {
    if (existsSync(base + ext)) tests.add(base + ext)
  }
}

if (!tests.size) {
  console.log('[gates:fast] 没有改动的测试文件，跳过测试（tsc / 静态门禁仍会跑）')
  process.exit(0)
}

const list = [...tests]
console.log(`[gates:fast] 相关测试 ${list.length} 个：\n  ${list.join('\n  ')}`)
const r = spawnSync(
  'npx',
  ['vitest', 'run', ...list, '--pool=forks', '--maxWorkers=4', '--minWorkers=1', '--passWithNoTests'],
  // Windows 上 npx 是 .cmd，不通过 shell 会 ENOENT；shell 只在拼命令时用一次。
  { stdio: 'inherit', shell: process.platform === 'win32' },
)
if (r.error) console.error('[gates:fast] 启动 vitest 失败：', r.error.message)
process.exit(r.status ?? 1)
