import { beforeAll, describe, it, expect } from 'vitest'
import { findArticle, type ArticleBook } from './matchArticle'

/**
 * 拿真的 public/articles.json 验一遍：库里每一条，都必须能用它自己的文件名找回来。
 *
 * 这条守的是「换期/重新抽取之后 App 还能自动带出原文」—— 抽取脚本写的键
 * 和音频文件名要是对不上，App 就静默退化成手动粘，没人会发现。
 *
 * 但那份文件**不在仓库里**（是从杂志 PDF 抽出来的正文，有版权，见 .gitignore），
 * 所以用 import.meta.glob 探测：没有就整组跳过，不能因为缺数据让测试红。
 * 自己跑过 tools/extract-articles.py 之后，这组才会真的执行。
 *
 * 注意这里**不能用顶层 await** 拿数据：vitest 里那个 await 不保证先落地，
 * `lib` 会是个 Promise（truthy），skipIf 判不出来，测试反而会红。
 * 所以用同步的 glob 结果判断，数据留到 beforeAll 再加载。
 */
const files = import.meta.glob('../../public/articles.json')
const hasLibrary = Object.keys(files).length > 0

describe.skipIf(!hasLibrary)('原文库（真实数据）', () => {
  let book: ArticleBook

  beforeAll(async () => {
    const load = Object.values(files)[0]!
    const mod = (await load()) as { default?: ArticleBook } & ArticleBook
    book = mod.default ?? mod
  })

  it('库非空，且每条都有正文和词数', () => {
    const keys = Object.keys(book)
    expect(keys.length).toBeGreaterThan(0)
    for (const k of keys) {
      expect(book[k]!.text.trim().length, k).toBeGreaterThan(0)
      expect(book[k]!.words, k).toBeGreaterThan(0)
    }
  })

  it('每条键 + .mp3 都能查回自己', () => {
    for (const k of Object.keys(book)) {
      expect(findArticle(book, `${k}.mp3`)?.text, k).toBe(book[k]!.text)
    }
  })

  it('词数和正文对得上（抽取脚本不会写出自相矛盾的条目）', () => {
    for (const k of Object.keys(book)) {
      const n = book[k]!.text.split(/\s+/).filter(Boolean).length
      expect(n, k).toBe(book[k]!.words)
    }
  })

  it('两期的键格式都对：2016 是「NNN 栏目 - 标题」，2021 是「NNN-栏目---标题-哈希」', () => {
    for (const k of Object.keys(book)) {
      // 2021 的栏目名里也有连字符（「Middle-East-and-Africa」），所以只能用「---」分界
      const dashed = /^\d{3}-.+---.+$/.test(k)
      const spaced = /^\d{3} .+ - .+$/.test(k)
      expect(dashed || spaced, k).toBe(true)
    }
  })

  it('陌生文件名不会被误认成库里某一篇', () => {
    expect(findArticle(book, '我的录音.mp3')).toBeNull()
    expect(findArticle(book, 'random.mp3')).toBeNull()
  })
})

describe.skipIf(hasLibrary)('原文库缺失（刚 clone 下来还没跑抽取脚本）', () => {
  it('这组测试被跳过，不算失败', () => {
    expect(hasLibrary).toBe(false)
    // 想跑真实数据：py tools/extract-articles.py ... 生成 public/articles.json
  })
})
