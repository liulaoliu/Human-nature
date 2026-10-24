import { describe, expect, it } from 'vitest'
import { devSpaRewrite } from './spa-route.mjs'

describe('devSpaRewrite：dev server 的 SPA 回落', () => {
  it('/reader 与 /reader/** 回落到 index.html', () => {
    expect(devSpaRewrite('/reader')).toBe('/index.html')
    expect(devSpaRewrite('/reader/a/my-article')).toBe('/index.html')
    expect(devSpaRewrite('/reader/a/my-article/p/plan')).toBe('/index.html')
  })

  it('query 原样保留', () => {
    expect(devSpaRewrite('/reader?x=1')).toBe('/index.html?x=1')
    expect(devSpaRewrite('/reader/a/x?p=1&q=2')).toBe('/index.html?p=1&q=2')
  })

  it('旧地址 /reader.html 也回落', () => {
    expect(devSpaRewrite('/reader.html')).toBe('/index.html')
    expect(devSpaRewrite('/reader.html?x=1')).toBe('/index.html?x=1')
  })

  it('带扩展名的缺失资源不回落（仍 404）', () => {
    expect(devSpaRewrite('/assets/nope.js')).toBe('/assets/nope.js')
    expect(devSpaRewrite('/reader/missing.js')).toBe('/reader/missing.js')
  })

  it('根路径与相似前缀不误伤', () => {
    expect(devSpaRewrite('/')).toBe('/')
    expect(devSpaRewrite('/readerx')).toBe('/readerx')
  })
})
