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
//   R8 <p> 里不许出现 <div>（非法 DOM 嵌套，React 会报 validateDOMNesting）
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
  'src/core/testSignals.ts', // 合成测试信号（只被 *.test / 测试夹具引用）
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

// R8 的规则说明放在下面实现处（要考虑跨组件，写长了）。
/** 去掉注释与字符串，避免把「文档里写的 <p>」当成真标签。 */
const stripJsxNoise = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/`[^`]*`/g, '``')

/** 找出每个 <p …> 的闭合位置（按同一文件里的 <p> 计数配对）。 */
function findParaBlocks(src) {
  const lines = src.split('\n')
  const blocks = []
  let depth = 0
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    const opens = (lines[i].match(/<p[\s>]/g) || []).length
    const closes = (lines[i].match(/<\/p>/g) || []).length
    if (opens && depth === 0) start = i
    depth += opens - closes
    if (depth <= 0 && start >= 0) {
      blocks.push({ start, end: i })
      depth = 0
      start = -1
    }
  }
  return blocks
}

// R8：<p> 里不许出现块级标签（非法 DOM 嵌套）
//
// 为什么管：HTML 规定 <p> 只能装 phrasing content（span / b / button…），
// 塞 <div> 属于非法嵌套。React 18 在 dev 下会打 `validateDOMNesting` 警告，
// 真机上还可能被浏览器容错解析（<p> 被提前闭合），把后面的结构挪位。
// 表现是「console 一片黄」或「某个块样式莫名跑到别处」，很难一眼看出根因。
//
// 怎么查（这条必须**跨组件**，否则等于没查）：
//   <p> 在 ReaderBody、渲染 div 的可能是它引用的 <LanguageLines>——
//   只看单个文件永远查不出来。所以策略是「组件渲染树里有没有块级标签」：
//     ① 先把每个 .tsx 按文件名索引成「组件名 → 文件」；
//     ② 对每个 <p>…</p> 块，看里面直接出现的块级标签，以及引用的自定义组件；
//     ③ 自定义组件递归看它自己（以及它引用的组件）渲染树里有没有块级标签。
//   只要有一条分支会渲染 <div>，它挂在 <p> 下面就是非法的——不区分分支是否走到。
//
// 唯一会误报的情形：组件某个分支渲染 div、而挂在 <p> 时永远走另一分支。
// 真遇到了在 EXCEPTIONS 登记，别把规则放宽（放宽就等于没规则）。
const BLOCK_TAGS = [
  'div', 'p', 'ul', 'ol', 'li', 'dl', 'dd', 'dt', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'caption', 'colgroup', 'section', 'article', 'aside', 'nav', 'header', 'footer', 'main', 'figure',
  'figcaption', 'form', 'fieldset', 'legend', 'blockquote', 'pre', 'hr', 'address', 'details', 'summary',
  'menu', 'center', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]
/** 非全局正则：带 /g 的 test() 会记住 lastIndex，循环里会漏判。 */
const BLOCK_TAG_RE = new RegExp(`<(${BLOCK_TAGS.join('|')})\\b`)

/** 组件名 → 文件（同名组件只保留第一处；本项目的命名本来就唯一）。 */
const componentFile = new Map()
for (const r of allRel) {
  const m = /\/([A-Za-z0-9_]+)\.tsx$/.exec(r)
  if (m && !componentFile.has(m[1])) componentFile.set(m[1], r)
}

/** 该文件的渲染树里是否会出现块级标签（含它引用的组件，递归）。 */
const blockCache = new Map()
function rendersBlockTag(relPath, seen = new Set()) {
  if (blockCache.has(relPath)) return blockCache.get(relPath)
  if (seen.has(relPath)) return false
  seen.add(relPath)
  const src = stripJsxNoise(read(relPath))
  let hit = BLOCK_TAG_RE.test(src)
  if (!hit) {
    // 再往下追一层：它引用的组件里有没有块级标签
    for (const m of src.matchAll(/<([A-Z][A-Za-z0-9_]*)\b/g)) {
      const child = componentFile.get(m[1])
      if (child && child !== relPath && rendersBlockTag(child, seen)) {
        hit = true
        break
      }
    }
  }
  blockCache.set(relPath, hit)
  return hit
}

for (const f of files.filter((f) => /^src\/(reader|ui)\//.test(rel(f)))) {
  const r = rel(f)
  if (skip(r)) continue
  const src = stripJsxNoise(read(f))
  const lines = src.split('\n')
  for (const { start, end } of findParaBlocks(src)) {
    const body = lines.slice(start, end + 1).join('\n')
    // 掐掉最外层那对 <p …> … </p>（不然外层的 <p 自己就命中规则）
    const inner = body.replace(/^[\s\S]*?<p\b[^>]*>/, '').replace(/<\/p>\s*$/, '')
    // ① 块内直接的块级标签
    const direct = inner.match(new RegExp(`<(${BLOCK_TAGS.join('|')})\\b`, 'g'))
    if (direct) {
      violations.push(
        `R8 ${r}:${start + 1} <p> 里直接放了块级标签 ${direct.join(' ')} —— 用 <span> + CSS 保持块级外观`,
      )
    }
    // ② 块内引用的自定义组件，渲染树里出现块级标签
    for (const m of inner.matchAll(/<([A-Z][A-Za-z0-9_]*)\b/g)) {
      const child = componentFile.get(m[1])
      if (!child) continue
      if (rendersBlockTag(child)) {
        violations.push(
          `R8 ${r}:${start + 1} <p> 里用了 <${m[1]}>，而 ${child} 的渲染树里有块级标签 —— p 只能装 phrasing content，改成 <span> + CSS`,
        )
      }
    }
  }
}

if (violations.length) {
  console.error('\n❌ 架构门禁未通过：')
  for (const v of violations) console.error('  - ' + v)
  console.error('\n（新违规请改代码；确实要留的存量违规，在 tool/check_architecture.mjs 的 EXCEPTIONS 里写明理由登记）')
  process.exit(1)
}

const debt = Object.keys(EXCEPTIONS)
console.log(`✅ 架构门禁通过（R1–R8）`)
if (debt.length) {
  console.log('存量豁免（看得见的债，建议尽快销账）：')
  for (const [f, why] of Object.entries(EXCEPTIONS)) console.log(`  - ${f}：${why}`)
}
