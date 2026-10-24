import { describe, expect, it } from 'vitest'
import { articleDateKeys, articleFingerprint } from './articleMeta'
import { segment } from './segmenter'
import type { SavedArticle } from '../types/document'

const seg = segment('Hello.')
const base: SavedArticle = {
  id: 'saved:1',
  title: 'A',
  sourceKey: null,
  text: 'Hello.',
  paragraphs: seg.paragraphs,
  sentences: seg.sentences,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
}

describe('articleFingerprint：内容有没有变', () => {
  it('同一份内容（即使对象重新创建）指纹一致', () => {
    expect(articleFingerprint({ ...base })).toBe(articleFingerprint({ ...base, paragraphs: [...base.paragraphs] }))
  })

  it('正文 / 标题 / 书名 / 来源 / 句子分析任一变化都会变', () => {
    const original = articleFingerprint(base)
    expect(articleFingerprint({ ...base, text: 'Hello!' })).not.toBe(original)
    expect(articleFingerprint({ ...base, title: 'B' })).not.toBe(original)
    expect(articleFingerprint({ ...base, book: 'Book' })).not.toBe(original)
    expect(articleFingerprint({ ...base, origin: 'paste' })).not.toBe(original)
    expect(
      articleFingerprint({
        ...base,
        sentences: [{ ...base.sentences[0], translation: '你好' }],
      }),
    ).not.toBe(original)
  })
})

describe('articleDateKeys：建立 / 修改日期', () => {
  it('建立与修改是同一天时只显示建立日', () => {
    expect(articleDateKeys(base)).toEqual({
      created: '2026-10-01',
      updated: '2026-10-01',
      edited: false,
    })
  })

  it('真的改过才标出修改日', () => {
    expect(articleDateKeys({ ...base, updatedAt: '2026-10-24T00:00:00.000Z' })).toEqual({
      created: '2026-10-01',
      updated: '2026-10-24',
      edited: true,
    })
  })

  it('老数据没有 createdAt：用 updatedAt 兜底，不显示成「改过」', () => {
    const { createdAt, ...legacy } = base
    void createdAt
    expect(articleDateKeys(legacy)).toEqual({
      created: '2026-10-01',
      updated: '2026-10-01',
      edited: false,
    })
  })

  it('坏时间不产出 NaN 日期', () => {
    expect(articleDateKeys({ createdAt: 'oops', updatedAt: 'bad' })).toEqual({
      created: '',
      updated: '',
      edited: false,
    })
  })
})
