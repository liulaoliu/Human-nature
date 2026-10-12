#!/usr/bin/env node
/**
 * ai-pack.mjs —— 命令行全自动跑完「AI 工作包」。
 *
 * 逐条调用 OpenAI 兼容的 Chat Completions 接口，把回答写进 `ai-results-*.json`，
 * 再回到应用里点「导入 AI 结果」即可一次应用全部。
 * （不想用命令行/不想配 key？用应用里的「⚡ 一键跑批」，或 `npm run ai:agent`。）
 *
 * 用法：
 *   node tools/ai-pack.mjs                      # 自动找 new/ 或当前目录最新的 ai-jobs-*.json
 *   node tools/ai-pack.mjs ai-jobs-2026-10-04.json out.json
 *
 * 配置（任选其一）：
 *   本机私密文件 config.local.json（已 gitignore，**推荐**）：
 *     { "ai": { "baseUrl": "https://api.deepseek.com", "apiKey": "sk-…",
 *               "model": "deepseek-chat", "concurrency": 3 } }
 *   或环境变量：DEEPSEEK_API_KEY / OPENAI_API_KEY、AI_BASE_URL、AI_MODEL
 *
 * ⚠️ 不要把 key 写进被 git 跟踪的 config.json。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadAiConfig, runJobs } from './ai-core.mjs'

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')

function latestJobsFile() {
  for (const dir of [join(ROOT, 'new'), ROOT]) {
    if (!existsSync(dir)) continue
    const files = readdirSync(dir)
      .filter((f) => /^ai-jobs-.*\.json$/.test(f) && !/\.results\.json$/.test(f))
      .sort()
    if (files.length) return join(dir, files[files.length - 1])
  }
  return null
}

async function main() {
  const cfg = loadAiConfig(ROOT)
  const inFile = process.argv[2] ? resolve(ROOT, process.argv[2]) : latestJobsFile()
  if (!inFile || !existsSync(inFile)) {
    console.error('找不到工作包文件：请先在应用里「导出 AI 工作包」，或传入文件名。')
    process.exit(1)
  }
  if (!cfg.apiKey) {
    console.error('没有 API key。把 key 写进 config.local.json 的 ai.apiKey，或设 DEEPSEEK_API_KEY。')
    console.error('也可以不配 key：用应用里的「⚡ 一键跑批（本机 agent）」，或把', basename(inFile), '交给本机 agent。')
    process.exit(1)
  }

  const pack = JSON.parse(readFileSync(inFile, 'utf8'))
  const jobs = Array.isArray(pack.jobs) ? pack.jobs : []
  if (!jobs.length) {
    console.error('工作包里没有 jobs。')
    process.exit(1)
  }
  console.log(`读取 ${inFile}：${jobs.length} 项待办，模型 ${cfg.model}，并发 ${cfg.concurrency}`)

  let done = 0
  const results = await runJobs(jobs, cfg, {
    onProgress: (d, total) => {
      done = d
      process.stdout.write(`\r进度 ${done}/${total}  `)
    },
  })
  process.stdout.write('\n')

  const ok = results.filter((r) => r.raw && r.raw.trim()).length
  const outFile = process.argv[3] ? resolve(ROOT, process.argv[3]) : join(ROOT, `ai-results-${new Date().toISOString().slice(0, 10)}.json`)
  writeFileSync(outFile, JSON.stringify({ version: 1, results }, null, 2), 'utf8')
  console.log(`完成：成功 ${ok} / ${jobs.length}，已写入 ${outFile}`)
  console.log('回到应用点「导入 AI 结果」选这个文件即可。')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
