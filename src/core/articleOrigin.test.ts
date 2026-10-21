import { describe, expect, it } from 'vitest'
import { ARTICLE_ORIGINS, ARTICLE_ORIGIN_LABEL, articleOriginLabel, isArticleOrigin } from './articleOrigin'

describe('已保存文章来源', () => {
  it('只认四个合法值；旧数据/坏值保持未知', () => {
    expect(ARTICLE_ORIGINS).toEqual(['library', 'paste', 'epub', 'file'])
    expect(isArticleOrigin('library')).toBe(true)
    expect(isArticleOrigin('file')).toBe(true)
    expect(isArticleOrigin('unknown')).toBe(false)
    expect(isArticleOrigin(undefined)).toBe(false)
  })

  it('显示文案与守卫共用同一份枚举', () => {
    expect(ARTICLE_ORIGIN_LABEL).toEqual({
      library: '原文库',
      paste: '粘贴',
      epub: 'EPUB',
      file: '文件',
    })
    expect(articleOriginLabel('epub')).toBe('EPUB')
    expect(articleOriginLabel('legacy')).toBeNull()
  })
})
