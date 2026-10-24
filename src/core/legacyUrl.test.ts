import { describe, expect, it } from 'vitest'
import { normalizeLegacyUrl } from './legacyUrl'

describe('normalizeLegacyUrl：旧地址迁到单入口 SPA', () => {
  it('index.html → 根路径，保留 query / hash', () => {
    expect(normalizeLegacyUrl('/index.html', '', '')).toBe('/')
    expect(normalizeLegacyUrl('/index.html', '?x=1', '#h')).toBe('/?x=1#h')
  })

  it('reader.html#/a/x → /reader/a/x', () => {
    expect(normalizeLegacyUrl('/reader.html', '', '#/a/x')).toBe('/reader/a/x')
  })

  it('reader.html 的 hash 是空或 / → 只留 /reader', () => {
    expect(normalizeLegacyUrl('/reader.html', '', '')).toBe('/reader')
    expect(normalizeLegacyUrl('/reader.html', '', '#/')).toBe('/reader')
  })

  it('reader.html 的 query 保留，hash 里的 query 原样带过去', () => {
    expect(normalizeLegacyUrl('/reader.html', '?from=old', '')).toBe('/reader?from=old')
    expect(normalizeLegacyUrl('/reader.html', '', '#/a/x?p=1')).toBe('/reader/a/x?p=1')
  })

  it('普通路径 / 新路径不动地址栏', () => {
    expect(normalizeLegacyUrl('/', '', '')).toBeNull()
    expect(normalizeLegacyUrl('/reader', '', '')).toBeNull()
    expect(normalizeLegacyUrl('/reader/a/my-article/p/plan', '', '')).toBeNull()
  })
})
