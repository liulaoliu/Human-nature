#!/usr/bin/env node
/**
 * ai-agent.mjs —— 用「本机 opencode agent」把 AI 工作包自动跑完（不需要 API key）。
 *
 * 它是 tools/ai-pack.mjs 的姊妹脚本：ai-pack 直连模型接口（要 key），本脚本不直连，
 * 而是**非交互**地起一个 opencode 会话（agent = ai-batch），让它读工作包、按内嵌
 * instructions 作答，写出 `new/ai-jobs-*.results.json`。
 *
 * 为什么不会像聊天那样反问你：`opencode run` 是非交互模式，跑完即退出，没有停下来
 * 确认的机会；ai-batch agent 的系统提示也写明「绝不提问」。
 *
 * 用法：
 *   npm run ai:agent                       # 自动找 new/ 里最新的 ai-jobs-*.json
 *   npm run ai:agent new/ai-jobs-x.json    # 指定工作包
 *   node tools/ai-agent.mjs new/ai-jobs-x.json new/out.json   # 指定输出
 *
 * 模型：默认用 opencode 当前配置的模型；可用 `AI_AGENT_MODEL=provider/model`
 * 或 config.local.json 的 `ai.agentModel` 覆盖（例如 `deepseek/deepseek-flash`）。
 *
 * 也可直接双击仓库根目录的「跑AI结果.cmd」。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NEW_DIR = join(ROOT, 'new')

/** new/ 目录下最新的 ai-jobs-*.json（排除 .results.json）。 */
function latestJobs() {
  if (!existsSync(NEW_DIR)) return null
  const files = readdirSync(NEW_DIR)
    .filter((f) => /^ai-jobs-.*\.json$/i.test(f) && !/\.results\.json$/i.test(f))
    .map((f) => ({ f, t: statSync(join(NEW_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  return files.length ? join(NEW_DIR, files[0].f) : null
}

function resultsPathFor(jobsPath) {
  return jobsPath.replace(/\.json$/i, '') + '.results.json'
}

function isJson(text) {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/** 从可能带杂质的输出里抠出一个结果 JSON（代码围栏 / 前后废话）。 */
function extractResultJson(text) {
  const t = String(text).replace(/\r\n/g, '\n')
  const fenced = t.match(/```(?:json)?\s*\n([\s\S]*?)\n```/)
  if (fenced && isJson(fenced[1])) return fenced[1]
  const first = t.indexOf('{')
  const last = t.lastIndexOf('}')
  if (first >= 0 && last > first) {
    const slice = t.slice(first, last + 1)
    if (isJson(slice)) return slice
  }
  return null
}

/** 从 config.local.json 的 ai.agentModel 或环境变量 AI_AGENT_MODEL 取模型（可选）。 */
function agentModel() {
  const fromEnv = process.env.AI_AGENT_MODEL
  if (fromEnv) return fromEnv
  try {
    const local = JSON.parse(readFileSync(join(ROOT, 'config.local.json'), 'utf8'))
    return local?.ai?.agentModel || ''
  } catch {
    return ''
  }
}

/** Windows 上拼 shell 命令行时给含空格/引号的参数加引号。 */
function winQuote(s) {
  return /[\s"]/.test(s) ? `"${String(s).replace(/"/g, '\\"')}"` : String(s)
}

function main() {
  const jobsPath = process.argv[2] ? resolve(ROOT, process.argv[2]) : latestJobs()
  if (!jobsPath || !existsSync(jobsPath)) {
    console.error('找不到工作包：先在应用里「导出 AI 工作包」到 new\\，或把文件名当参数传入。')
    process.exit(1)
  }
  const outPath = process.argv[3] ? resolve(ROOT, process.argv[3]) : resultsPathFor(jobsPath)
  const relIn = relative(ROOT, jobsPath).replace(/\\/g, '/')
  const relOut = relative(ROOT, outPath).replace(/\\/g, '/')

  console.log(`工作包  : ${relIn}`)
  console.log(`结果写到: ${relOut}`)
  const model = agentModel()
  if (model) console.log(`模型    : ${model}（AI_AGENT_MODEL / config.local.json）`)
  console.log('启动 opencode agent（非交互，不会提问）…\n')

  // 只保留 ASCII，避免 Windows cmd.exe 传参的编码问题；目录名不含空格（new/...）。
  const message =
    `Process ${relIn} as an AI job pack: follow its instructions field, answer every job, ` +
    `and write the result JSON to ${relOut}. Do only this and never ask questions.`

  const args = ['run', '--agent', 'ai-batch', '--auto']
  if (model) args.push('--model', model)
  args.push(message)

  // Windows 上 opencode 是 .cmd，Node 必须走 shell 才能拉起；
  // POSIX 直接 spawn 参数数组（旧写法把整串命令当文件名，Linux/macOS 会 ENOENT）。
  const useShell = process.platform === 'win32'
  const res = useShell
    ? spawnSync(['opencode', ...args].map(winQuote).join(' '), {
        cwd: ROOT,
        shell: true,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
      })
    : spawnSync('opencode', args, {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
      })

  if (res.error) {
    console.error('启动 opencode 失败：', res.error.message)
    console.error('请确认 `opencode` 在 PATH 中，且已用 opencode 配置过可用的模型/供应商。')
    process.exit(1)
  }

  // 首选：agent 自己写出的结果文件
  if (existsSync(outPath)) {
    if (isJson(readFileSync(outPath, 'utf8'))) {
      console.log(`\n✅ 完成：${relOut}`)
      console.log('回到应用点「导入 AI 结果」选这个文件即可。')
      return
    }
    console.warn('结果文件不是合法 JSON，尝试从输出回退…')
  }

  // 回退：从 stdout 抠出 JSON 再落盘
  const json = extractResultJson(res.stdout || '')
  if (json) {
    writeFileSync(outPath, json, 'utf8')
    console.log(`\n✅ 完成（从输出回退）：${relOut}`)
    console.log('回到应用点「导入 AI 结果」选这个文件即可。')
    return
  }

  console.error('\n❌ 没拿到结果文件，也没能从输出里解析出 JSON。')
  console.error('agent 输出片段：\n' + (res.stdout || '').slice(-2000))
  process.exit(1)
}

main()
