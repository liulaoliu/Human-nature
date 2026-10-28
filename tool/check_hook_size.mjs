// ============================================================
// check_hook_size.mjs — hook 体量门禁
//
// 为什么单独管 hook：
//   普通文件有 800 行上帝文件门禁，但 hook 是「状态 + 派生 + 动作 + effect」的混合体，
//   一旦靠到 600 行，改一个分支要读全文、测试也难聚焦。等它超 800 再拆已经晚了。
// 规则：
//   1. 新 hook 超过 500 行 → 失败（先拆职责再写）；
//   2. 480–500 行打印提醒（还能读，但别再往里塞）；
//   3. 存量超限登记在 BASELINE，只准变小；降回 500 以内后必须删掉基线；
//   4. 基线文件变大 → 失败。
//
// 用法：node tool/check_hook_size.mjs
// ============================================================
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const MAX_HOOK_LINES = 500
export const WARN_HOOK_LINES = 480

/** 存量超限 hook：相对路径 → 允许的最高行数（只准下调）。 */
export const BASELINE = {
  'src/reader/hooks/useStudySession.ts': 718,
  'src/reader/hooks/useQuizSession.ts': 581,
  'src/reader/hooks/useAiPack.ts': 536,
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'public', 'build'])
const HOOK_RE = /(^|\/)use[A-Z][^/]*\.(ts|tsx)$/

/** 纯函数：给文件行数，返回违规 / 提醒（测试直接调它）。 */
export function auditHookSizes(entries, baseline = BASELINE, max = MAX_HOOK_LINES, warn = WARN_HOOK_LINES) {
  const violations = []
  const warnings = []
  const notes = []
  const seen = new Set()

  for (const { file, lines } of entries) {
    seen.add(file)
    const limit = baseline[file]
    if (limit !== undefined) {
      if (lines > limit) {
        violations.push(`${file}: ${lines} 行 > 基线 ${limit} 行 —— 存量 hook 只准变小，不准再塞`)
      } else if (lines < limit) {
        notes.push(`${file}: 已缩到 ${lines} 行（基线 ${limit}），请把 BASELINE 下调到 ${lines}`)
      }
      if (lines <= max) {
        violations.push(`${file}: ${lines} 行已回到 ${max} 行以内 —— 请从 BASELINE 删除这条债务`)
      }
      continue
    }
    if (lines > max) {
      violations.push(`${file}: ${lines} 行 > 上限 ${max} 行 —— 先按职责拆分，再继续加逻辑`)
    } else if (lines > warn) {
      warnings.push(`${file}: ${lines} 行，已接近 ${max} 行上限；新逻辑优先拆子 hook`)
    }
  }

  for (const file of Object.keys(baseline)) {
    if (!seen.has(file)) violations.push(`${file}: BASELINE 里的文件已经不存在，请删掉这条债务`)
  }
  return { violations, warnings, notes }
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p, out)
    } else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

function main() {
  const root = process.cwd()
  const entries = walk('src')
    .map((file) => relative(root, file).replace(/\\/g, '/'))
    .filter((file) => HOOK_RE.test(file) && !/\.test\.(ts|tsx)$/.test(file))
    .map((file) => ({ file, lines: readFileSync(join(root, file), 'utf8').split('\n').length }))

  const { violations, warnings, notes } = auditHookSizes(entries)
  if (warnings.length) {
    console.log('提示：以下 hook 接近上限，改动时优先拆职责：')
    for (const w of warnings) console.log('  - ' + w)
  }
  if (notes.length) {
    console.log('提示：以下 hook 已比基线小，记得同步下调：')
    for (const n of notes) console.log('  - ' + n)
  }
  if (violations.length) {
    console.error('\n❌ hook 体量门禁未通过：')
    for (const v of violations) console.error('  - ' + v)
    console.error('\n（拆分规则见 docs/ARCHITECTURE.md「拆文件：拆职责，不是拆行数」）')
    process.exitCode = 1
    return
  }
  console.log(`✅ hook 体量门禁通过（新 hook ≤ ${MAX_HOOK_LINES} 行，存量只减不增）`)
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (entry && import.meta.url === entry) main()
