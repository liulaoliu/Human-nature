import { describe, expect, it } from 'vitest'
import { shortHash, slugify } from './articleSlug'

describe('slugify：标题 → URL 片段', () => {
  it('常规标题：小写 + 空格转连字符', () => {
    expect(slugify('005 Leaders - Post-truth politics')).toBe('005-leaders-post-truth-politics')
  })

  it('下划线 / 撇号 / 多余分隔符都压成一个连字符', () => {
    expect(slugify("England_s National Health Service")).toBe('england-s-national-health-service')
    expect(slugify('a   ---   b')).toBe('a-b')
    expect(slugify('--trim me--')).toBe('trim-me')
  })

  it('重音符号被去掉（café → cafe）', () => {
    expect(slugify('Café Société')).toBe('cafe-societe')
  })

  it('中文 / 纯符号算不出 slug，返回空串（由调用方退回 article-<hash>）', () => {
    expect(slugify('中文标题')).toBe('')
    expect(slugify('！！！')).toBe('')
    expect(slugify('')).toBe('')
  })

  it('超长标题截断，且不以连字符结尾', () => {
    const long = slugify('a'.repeat(100))
    expect(long.length).toBeLessThanOrEqual(72)
    const spaced = slugify(`${'word '.repeat(30)}tail`)
    expect(spaced.length).toBeLessThanOrEqual(72)
    expect(spaced.endsWith('-')).toBe(false)
  })

  it('结果里只有 [a-z0-9-]（地址栏不需要百分号转义）', () => {
    for (const s of ['005 Leaders - Post-truth politics', 'Café & Bar #1', 'a/b?c=d']) {
      expect(slugify(s)).toMatch(/^[a-z0-9-]*$/)
    }
  })
})

describe('shortHash：稳定短哈希', () => {
  it('同一输入永远同一结果，长度 4', () => {
    const a = shortHash('b:005 Leaders')
    expect(a).toBe(shortHash('b:005 Leaders'))
    expect(a).toHaveLength(4)
    expect(a).toMatch(/^[a-z0-9]{4}$/)
  })

  it('不同输入基本不会撞（这里只钉住几个已知值不变）', () => {
    const set = new Set(['b:a', 'b:b', 's:1', 's:2', '中文'].map(shortHash))
    expect(set.size).toBe(5)
  })
})
