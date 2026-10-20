// ============================================================
// check_architecture.mjs — 架构门禁（可执行的约定）
//
// 灵感来自 patrol_helper 的 CI 门禁工具（check_god_class / check_info_filter_options）：
// 架构约定不落成可执行检查，三个月后必然退化。这里只查**机器能确定**的东西。
//
// 用法：node tool/check_architecture.mjs   （退出码 0 通过 / 1 违规）
//
// 规则（详细说明见 docs/ARCHITECTURE.md）：
//   R1 core/ 不许依赖 react / reader / adapters / ui / state，也不许直接碰浏览器 API
//   R2 adapters/ 不许依赖 react / reader
//   R3 展示层（reader/panels、ui）不许直接读写 localStorage / IndexedDB
//   R4 hooks 不许直接碰 IndexedDB（仓储要注入）
//   R5 词条类型的名字只在 core/entryKind.ts 定义（视图里不许再抄一份字面量）
//   R6 日期键只走 core/activity（不许自己拼 YYYY-MM-DD / 用 toISOString().slice(0,10)）
//   R7 core 下每个模块要有同名测试（白名单 = 纯数据/纯类型/测试夹具）
//
// EXCEPTIONS：存量违规登记（**必须写理由**，且会每次打印出来 —— 债务要看得见）。
// 新增违规一律修代码，不许随手登记。
// ============================================================
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'public', 'build'])

/** 存量违规（路径 → 理由）。能修就修，登记只是让门禁先能上线。 */
const EXCEPTIONS = {
  'src/core/stateBackup.ts': 'R6：备份文件名里的日期（UTC），不是学习日，故意不动',
}

/** core 里没有同名测试的模块（纯数据 / 纯类型 / 测试夹具 / 待补测试的债）。 */
const NO_TEST_OK = new Set([
  'src/core/testSignals.ts',
  'src/core/ttsVoices.ts',
  'src/core/dictionary.ts', // TODO：浏览器 fetch 加载器，应该挪到 adapters/
  'src/core/ports.ts', // 只有接口与类型
  'src/core/testFixtures.ts', // 测试夹具本身
])

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p, out)
    } else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

const rel = (p) => relative(process.cwd(), p).replace(/\\/g, '/')
const files = walk('src')
const read = (p) => readFileSync(p, 'utf8')
const importsOf = (src) => [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])
/** 去掉注释再扫描：注释里提「localStorage」不算违规。 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
/**
 * 真正「碰浏览器」的写法（不是英文散文里出现 window/document 这个词）：
 * 只认具体 API —— `document.querySelector`、`window.print`、`localStorage.` …
 */
const BROWSER_API =
  /(?:document\.(?:querySelector|querySelectorAll|createElement|createElementNS|body|head|title|addEventListener|documentElement|getElementById|createTextNode|createRange|execCommand)|window\.(?:location|print|open|addEventListener|removeEventListener|setTimeout|clearTimeout|setInterval|clearInterval|matchMedia|innerWidth|innerHeight|scrollTo|requestAnimationFrame|cancelAnimationFrame|getSelection)|localStorage\.|indexedDB\.)/
/** 代码里是否真的碰了浏览器 API（注释与散文不算）。 */
const touchesBrowser = (src) => BROWSER_API.test(stripComments(src))
const isTest = (r) => /\.test\.tsx?$/.test(r)
const skip = (r) => isTest(r) || EXCEPTIONS[r] !== undefined

const violations = []

// R1：core 不许依赖界面/IO
for (const f of files.filter((f) => rel(f).startsWith('src/core/'))) {
  const r = rel(f)
  if (isTest(r)) continue
  const src = read(f)
  for (const spec of importsOf(src)) {
    const bad =
      spec === 'react' ||
      spec.startsWith('react-') ||
      spec.includes('/reader/') ||
      spec.includes('/adapters/') ||
      spec.includes('/ui/') ||
      spec.includes('/state/')
    if (bad && EXCEPTIONS[r] === undefined) violations.push(`R1 ${r} → ${spec}（core 必须能脱离界面/存储单跑）`)
  }
  if (!skip(r) && touchesBrowser(src)) {
    violations.push(`R1 ${r} 直接用了浏览器 API（IO 请放 adapters/）`)
  }
}

// R2：adapters 不许依赖界面
for (const f of files.filter((f) => rel(f).startsWith('src/adapters/'))) {
  const r = rel(f)
  for (const spec of importsOf(read(f))) {
    if ((spec === 'react' || spec.startsWith('react-') || spec.includes('/reader/')) && EXCEPTIONS[r] === undefined) {
      violations.push(`R2 ${r} → ${spec}`)
    }
  }
}

// R3：展示层不许直接读写 localStorage / IndexedDB
for (const f of files.filter((f) => /^src\/(reader\/panels|ui)\//.test(rel(f)))) {
  const r = rel(f)
  if (skip(r)) continue
  if (/\b(localStorage|indexedDB)\b/.test(stripComments(read(f)))) violations.push(`R3 ${r} 直接读写 localStorage/IndexedDB`)
}

// R4：hooks 不许碰 IndexedDB
for (const f of files.filter((f) => rel(f).startsWith('src/reader/hooks/'))) {
  const r = rel(f)
  if (skip(r)) continue
  if (/indexedDB/.test(stripComments(read(f)))) violations.push(`R4 ${r} 直接碰 IndexedDB（仓储请注入）`)
}

// R5：类型名字只在 entryKind.ts 定义（视图不许抄字面量）
for (const f of files.filter((f) => /^src\/(reader|ui)\//.test(rel(f)))) {
  const r = rel(f)
  if (skip(r)) continue
  const src = read(f)
  for (const label of ['词组', '习语', '用法', '单词']) {
    // 只拦「整串就是这个词」的字面量（提示语里的自然语言不算）
    if (new RegExp(`['"\`]${label}['"\`]`).test(src)) {
      violations.push(`R5 ${r} 硬写了字面量「${label}」—— 用 core/entryKind 的 KIND_LABEL / KIND_ORDER`)
    }
  }
}

// R6：日期键只走 core/activity
for (const f of files.filter((f) => rel(f).startsWith('src/'))) {
  const r = rel(f)
  if (skip(r) || r === 'src/core/activity.ts') continue
  const code = stripComments(read(f))
  const handRolled =
    /toISOString\(\)\.slice\(0, 10\)/.test(code) ||
    code.split('\n').some((l) => /getFullYear\(\)/.test(l) && !/calendarDayKey|dayKeyLocal/.test(l))
  if (handRolled) {
    violations.push(`R6 ${r} 自己拼了 YYYY-MM-DD —— 用 core/activity 的 dayKeyLocal / calendarDayKey`)
  }
}

// R7：core 模块要有同名测试
const allRel = files.map(rel)
for (const r of allRel.filter((r) => r.startsWith('src/core/') && !isTest(r))) {
  if (NO_TEST_OK.has(r)) continue
  const test = r.replace(/\.ts$/, '.test.ts')
  if (!allRel.includes(test)) violations.push(`R7 ${r} 没有同名测试（${test}）`)
}

if (violations.length) {
  console.error('\n❌ 架构门禁未通过：')
  for (const v of violations) console.error('  - ' + v)
  console.error('\n（新违规请改代码；确实要留的存量违规，在 tool/check_architecture.mjs 的 EXCEPTIONS 里写明理由登记）')
  process.exit(1)
}

const debt = Object.keys(EXCEPTIONS)
console.log(`✅ 架构门禁通过（R1–R7）`)
if (debt.length) {
  console.log('存量豁免（看得见的债，建议尽快销账）：')
  for (const [f, why] of Object.entries(EXCEPTIONS)) console.log(`  - ${f}：${why}`)
}
