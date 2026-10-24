import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { defaultOutFile, parsePack } from './ai-pack.mjs'

describe('ai-pack：工作包解析 / 默认输出名', () => {
  it('正常 jobs 原样返回', () => {
    const jobs = [{ id: 'a', task: 'lookup', prompt: 'p' }]
    expect(parsePack(JSON.stringify({ version: 1, jobs }))).toEqual(jobs)
  })

  it('坏 JSON / jobs 不是数组 / 空对象 → 空数组（让 CLI 给明确提示）', () => {
    expect(parsePack('{oops')).toEqual([])
    expect(parsePack(JSON.stringify({ jobs: 'nope' }))).toEqual([])
    expect(parsePack(JSON.stringify({}))).toEqual([])
    expect(parsePack('')).toEqual([])
  })

  it('默认输出按 UTC 日期命名，和结果文件口径一致', () => {
    const root = join('C:', 'xueba')
    expect(defaultOutFile(root, new Date('2026-10-24T23:59:00.000Z'))).toBe(
      join(root, 'ai-results-2026-10-24.json'),
    )
  })
})
