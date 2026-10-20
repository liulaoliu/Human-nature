import { describe, expect, it, vi } from 'vitest'
import { fetchTimings, prefetchAudio, timingKey } from './ttsCache'

function ok(body: unknown): Response {
  return { ok: true, json: async () => body } as Response
}

const parts = [
  { part: 'Hello', start: 0, end: 300 },
  { part: 'world', start: 300, end: 600 },
]

describe('timingKey', () => {
  it('音色不同 / 文本不同都不会撞 key', () => {
    expect(timingKey('a', 'x')).not.toBe(timingKey('b', 'x'))
    expect(timingKey('a', 'x')).not.toBe(timingKey('a', 'y'))
    expect(timingKey('a', 'x')).toBe(timingKey('a', 'x'))
  })
})

describe('fetchTimings', () => {
  it('成功：请求带编码参数，返回与文本对齐的时间戳', async () => {
    const f = vi.fn().mockResolvedValue(ok(parts))
    const got = await fetchTimings('en-US Aria', 'Hello world & more', f as never)
    expect(f).toHaveBeenCalledWith(
      `/api/tts/words?voice=${encodeURIComponent('en-US Aria')}&text=${encodeURIComponent('Hello world & more')}`,
    )
    // '&' 不算词：多出来的词没有对应时间戳时给 0（宁可不高亮，不错配）
    expect(got).toEqual([
      { start: 0, end: 300 },
      { start: 300, end: 600 },
      { start: 0, end: 0 },
    ])
  })

  it('非 2xx / 空数组 / 形状不对 / 网络异常：一律 null（降级为不高亮）', async () => {
    await expect(fetchTimings('v', 't', vi.fn().mockResolvedValue({ ok: false, json: async () => parts } as Response) as never)).resolves.toBeNull()
    await expect(fetchTimings('v', 't', vi.fn().mockResolvedValue(ok([])) as never)).resolves.toBeNull()
    await expect(fetchTimings('v', 't', vi.fn().mockResolvedValue(ok({ nope: 1 })) as never)).resolves.toBeNull()
    await expect(fetchTimings('v', 't', vi.fn().mockRejectedValue(new Error('offline')) as never)).resolves.toBeNull()
  })

  it('json 解析失败也吞掉', async () => {
    const bad = { ok: true, json: async () => { throw new Error('bad json') } } as unknown as Response
    await expect(fetchTimings('v', 't', vi.fn().mockResolvedValue(bad) as never)).resolves.toBeNull()
  })
})

describe('prefetchAudio', () => {
  it('HEAD 触发合成；成功返回 true', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true } as Response)
    await expect(prefetchAudio('v', 't', f as never)).resolves.toBe(true)
    expect(f).toHaveBeenCalledWith('/api/tts?voice=v&text=t', { method: 'HEAD' })
  })

  it('网络异常返回 false（允许之后重试）', async () => {
    await expect(prefetchAudio('v', 't', vi.fn().mockRejectedValue(new Error('down')) as never)).resolves.toBe(false)
  })

  it('服务端 5xx 也视为已请求（不反复重试）', async () => {
    await expect(prefetchAudio('v', 't', vi.fn().mockResolvedValue({ ok: false } as Response) as never)).resolves.toBe(true)
  })
})
