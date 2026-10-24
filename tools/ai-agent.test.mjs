import { afterEach, describe, expect, it } from 'vitest'
import { agentModel, extractResultJson, isJson, resultsPathFor, winQuote } from './ai-agent.mjs'

const saved = process.env.AI_AGENT_MODEL

afterEach(() => {
  if (saved === undefined) delete process.env.AI_AGENT_MODEL
  else process.env.AI_AGENT_MODEL = saved
})

describe('ai-agent：结果路径 / 输出抠 JSON / Windows 引号', () => {
  it('结果文件名 = 工作包同名 + .results.json', () => {
    expect(resultsPathFor('new/ai-jobs-2026-10-24.json')).toBe('new/ai-jobs-2026-10-24.results.json')
    expect(resultsPathFor('new/ai-jobs-X.JSON')).toBe('new/ai-jobs-X.results.json')
  })

  it('代码围栏里的 JSON 优先，围栏坏了再从首尾大括号抠', () => {
    expect(extractResultJson('```json\n{"id":"a","raw":"x"}\n```')).toBe('{"id":"a","raw":"x"}')
    expect(extractResultJson('前面的废话\n{"id":"b"}\n后面的废话')).toBe('{"id":"b"}')
    expect(extractResultJson('```json\nnot json\n```')).toBeNull()
    expect(extractResultJson('完全没有 JSON')).toBeNull()
  })

  it('isJson 只认合法 JSON', () => {
    expect(isJson('{"a":1}')).toBe(true)
    expect(isJson('[1,2]')).toBe(true)
    expect(isJson('{a:1}')).toBe(false)
  })

  it('Windows shell 参数只在含空格/引号时加引号', () => {
    expect(winQuote('opencode')).toBe('opencode')
    expect(winQuote('new/ai-jobs-x.json')).toBe('new/ai-jobs-x.json')
    expect(winQuote('a b')).toBe('"a b"')
    expect(winQuote('say "hi"')).toBe('"say \\"hi\\""')
  })

  it('AI_AGENT_MODEL 环境变量优先', () => {
    process.env.AI_AGENT_MODEL = 'provider/model'
    expect(agentModel()).toBe('provider/model')
  })
})
