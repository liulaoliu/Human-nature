import { describe, it, expect } from 'vitest'
import book from '../../public/articles.json'
import { findArticle, type ArticleBook } from './matchArticle'

/**
 * 拿真的 public/articles.json 验一遍：库里每一条，都必须能用它自己的文件名找回来。
 *
 * 这条守的是「换期/重新抽取之后 App 还能自动带出原文」—— 抽取脚本写的键
 * 和音频文件名要是对不上，App 就静默退化成手动粘，没人会发现。
 */
describe('原文库（真实数据）', () => {
  const lib = book as ArticleBook
  const keys = Object.keys(lib)

  it('库非空，且每条都有正文和词数', () => {
    expect(keys.length).toBeGreaterThan(0)
    for (const k of keys) {
      expect(lib[k]!.text.trim().length).toBeGreaterThan(0)
      expect(lib[k]!.words).toBeGreaterThan(0)
    }
  })

  it('每条键 + .mp3 都能查回自己', () => {
    for (const k of keys) {
      expect(findArticle(lib, `${k}.mp3`)?.text, k).toBe(lib[k]!.text)
    }
  })

  it('词数和正文对得上（抽取脚本不会写出自相矛盾的条目）', () => {
    for (const k of keys) {
      const n = lib[k]!.text.split(/\s+/).filter(Boolean).length
      expect(n, k).toBe(lib[k]!.words)
    }
  })

  it('两期的键格式都对：2016 是「NNN 栏目 - 标题」，2021 是「NNN-栏目---标题-哈希」', () => {
    for (const k of keys) {
      // 2021 的栏目名里也有连字符（「Middle-East-and-Africa」），所以只能用「---」分界
      const dashed = /^\d{3}-.+---.+$/.test(k)
      const spaced = /^\d{3} .+ - .+$/.test(k)
      expect(dashed || spaced, k).toBe(true)
    }
  })

  it('陌生文件名不会被误认成库里某一篇', () => {
    expect(findArticle(lib, '我的录音.mp3')).toBeNull()
    expect(findArticle(lib, 'random.mp3')).toBeNull()
  })
})
