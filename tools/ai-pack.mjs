#!/usr/bin/env node
/**
 * ai-pack.mjs —— 把「AI 工作包」自动跑完。
 *
 * 应用导出的 `ai-jobs-*.json` 里每个 job 都是一条完整提示词；本脚本逐条调用
 * OpenAI 兼容的 Chat Completions 接口，把回答写进 `ai-results-*.json`，
 * 再回到应用里点「导入 AI 结果」即可一次应用全部。
 *
 * 用法：
 *   node tools/ai-pack.mjs                      # 自动找最新的 ai-jobs-*.json
 *   node tools/ai-pack.mjs ai-jobs-2026-10-04.json out.json
 *
 * 配置（任选其一）：
 *   环境变量：DEEPSEEK_API_KEY / OPENAI_API_KEY、AI_BASE_URL、AI_MODEL
 *   config.json：{ "ai": { "baseUrl": "https://api.deepseek.com", "apiKey": "sk-…",
 *                          "model": "deepseek-chat", "concurrency": 3 } }
 *
 * 不配 key 也行：把 ai-jobs-*.json 直接交给本机 agent（opencode 等），让它按同样的
 * 结果格式产出 ai-results-*.json —— 效果一样，且不用 key。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, basename } from 'node:path'

const SYSTEM_PROMPT =
  '你是英语学习工具的批处理引擎。用户会给你一条已经写好的提示词，' +
  '请严格按提示词要求输出结果。只输出结果本身，不要解释、不要 Markdown 代码围栏。'

function loadConfig() {
  const cfg = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: '', concurrency: 3 }
  if (existsSync('config.json')) {
    try {
      const raw = JSON.parse(readFileSync('config.json', 'utf8'))
      Object.assign(cfg, raw.ai ?? {})
    } catch {
      // 忽略
    }
  }
  cfg.apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || cfg.apiKey || ''
  cfg.baseUrl = process.env.AI_BASE_URL || cfg.baseUrl
  cfg.model = process.env.AI_MODEL || cfg.model
  return cfg
}

function latestJobsFile() {
  const files = readdirSync('.').filter((f) => /^ai-jobs-.*\.json$/.test(f))
  if (!files.length) return null
  files.sort()
  return files[files.length - 1]
}

async function callOnce(cfg, prompt) {
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  const data = await res.json()
  return data?.choices?.[0]?.message?.content ?? ''
}

async function callWithRetry(cfg, prompt, tries = 3) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try {
      return await callOnce(cfg, prompt)
    } catch (e) {
      lastErr = e
      await new Promise((r) => setTimeout(r, 800 * (i + 1)))
    }
  }
  throw lastErr
}

async function main() {
  const cfg = loadConfig()
  const inFile = process.argv[2] || latestJobsFile()
  if (!inFile || !existsSync(inFile)) {
    console.error('找不到工作包文件：请先在应用里「导出 AI 工作包」，或传入文件名。')
    process.exit(1)
  }
  if (!cfg.apiKey) {
    console.error('没有 API key。设置 DEEPSEEK_API_KEY，或写进 config.json 的 ai.apiKey。')
    console.error('也可以不配 key：把', basename(inFile), '直接交给本机 agent。')
    process.exit(1)
  }

  const pack = JSON.parse(readFileSync(inFile, 'utf8'))
  const jobs = Array.isArray(pack.jobs) ? pack.jobs : []
  if (!jobs.length) {
    console.error('工作包里没有 jobs。')
    process.exit(1)
  }
  console.log(`读取 ${inFile}：${jobs.length} 项待办，模型 ${cfg.model}，并发 ${cfg.concurrency}`)

  const results = new Array(jobs.length)
  let cursor = 0
  let done = 0
  const worker = async () => {
    while (cursor < jobs.length) {
      const i = cursor++
      const job = jobs[i]
      try {
        const raw = await callWithRetry(cfg, job.prompt)
        results[i] = { id: job.id, raw }
      } catch (e) {
        console.warn(`⚠️ ${job.id} 失败：${e.message}`)
        results[i] = { id: job.id, raw: '' }
      }
      done++
      process.stdout.write(`\r进度 ${done}/${jobs.length}  `)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, cfg.concurrency | 0) }, worker))
  process.stdout.write('\n')

  const ok = results.filter((r) => r.raw && r.raw.trim()).length
  const outFile = process.argv[3] || `ai-results-${new Date().toISOString().slice(0, 10)}.json`
  writeFileSync(outFile, JSON.stringify({ version: 1, results }, null, 2), 'utf8')
  console.log(`完成：成功 ${ok} / ${jobs.length}，已写入 ${resolve(outFile)}`)
  console.log('回到应用点「导入 AI 结果」选这个文件即可。')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
