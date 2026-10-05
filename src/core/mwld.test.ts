import { describe, it, expect } from 'vitest'
import { mwldLookup, parseMwld } from './mwld'

const tsv = [
  'allow\təˈlaʊ\tverb\tto permit something',
  'hobble\tˈhɑːbəl\tverb\tto walk with difficulty',
].join('\n')

const m = parseMwld(tsv)

describe('parseMwld / mwldLookup', () => {
  it('解析四列', () => {
    expect(m.get('allow')).toEqual({
      word: 'allow',
      phonetic: 'əˈlaʊ',
      pos: 'verb',
      en: 'to permit something',
    })
  })
  it('直接命中', () => {
    expect(mwldLookup(m, 'hobble')?.en).toBe('to walk with difficulty')
  })
  it('经词形→原形表还原后命中', () => {
    const forms = new Map([['hobbled', 'hobble']])
    expect(mwldLookup(m, 'hobbled', forms)?.word).toBe('hobble')
  })
  it('查不到返回 null', () => {
    expect(mwldLookup(m, 'zzzz')).toBeNull()
  })
})
