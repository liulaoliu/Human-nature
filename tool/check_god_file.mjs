// ============================================================
// check_god_file.mjs — 「上帝文件」体检门禁（源自 patrol_helper 的
// tool/check_god_class.dart，阈值语义与「存量基线禁增长」机制照搬）
//
// 为什么需要：文件一过千行，改一处要读全文、测试难写、冲突不断，
// 新功能就会默认往里塞（本项目 ReaderApp 曾一路涨到 3200+ 行）。
// 门禁规则：
//   1. **新增**超限文件 → 失败（新逻辑不许再进大文件，拆出去再写）；
//   2. 存量超限文件登记在 BASELINE → 允许存在，但**只准变小、不准变大**；
//   3. 拆分后同步下调基线（基线是债务，不是豁免）。
//
// 用法：node tool/check_god_file.mjs        （退出码 0 通过 / 1 违规）
// 阈值：单文件 > 800 行即超限。（*.test.ts 放宽到 1000：测试用表格驱动本来就长。）
// ============================================================
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const MAX_LINES = 800
const MAX_TEST_LINES = 1000
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'public', 'build'])

/**
 * 存量超限基线：相对路径 → 允许的最高行数（**只准下调**）。
 * 登记即承认债务；拆分后必须把这里的数字改小（同一次提交里改）。
 */
const BASELINE = {
  'src/reader/ReaderApp.tsx': 1548,
  'src/ui/App.tsx': 1192,
  'src/state/session.ts': 1186,
  'src/core/vocab.ts': 1123,
  'src/state/session.test.ts': 1058,
  'src/state/script.test.ts': 803,
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p, out)
    } else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

const violations = []
for (const file of [...walk('src'), ...walk('tools'), ...walk('server')]) {
  const rel = relative(process.cwd(), file).replace(/\\/g, '/')
  const lines = readFileSync(file, 'utf8').split('\n').length
  const limit = /\.test\.(?:tsx?|js)$/.test(rel) ? MAX_TEST_LINES : MAX_LINES
  const baseline = BASELINE[rel]
  if (baseline !== undefined) {
    if (lines > baseline) {
      violations.push(`${rel}: ${lines} 行 > 基线 ${baseline} 行 —— 存量大文件只准变小，不准再塞（拆出去再加）`)
    } else if (lines < baseline) {
      console.log(`提示：${rel} 已缩到 ${lines} 行（基线 ${baseline}），请把 BASELINE 里这个数字下调到 ${lines}（债务要同步销账）`)
    }
  } else if (lines > limit) {
    violations.push(`${rel}: ${lines} 行 > 上限 ${limit} 行 —— 新逻辑请拆成独立模块（见 docs/ARCHITECTURE.md「放哪里」）`)
  }
}

if (violations.length) {
  console.error('\n❌ 上帝文件门禁未通过：')
  for (const v of violations) console.error('  - ' + v)
  process.exit(1)
}
console.log('✅ 上帝文件门禁通过（无新增超限，存量未增长）')
