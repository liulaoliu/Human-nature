import { describe, it, expect } from 'vitest'
import {
  KIND_LABEL,
  KIND_ORDER,
  filterByKind,
  isLangPoint,
  isStudyable,
  isWordEntry,
  kindOf,
  langEntries,
  wordEntries,
} from './entryKind'
import { vocabItem } from './testFixtures'
import type { VocabKind } from '../types/document'

/**
 * 词条类型这一层的小工具：跨模块都要问「这条是哪一类」，所以行为必须钉住。
 */
describe('kindOf / 标签 / 顺序', () => {
  it('老数据没有 kind → 当普通单词', () => {
    expect(kindOf({})).toBe('word')
    expect(kindOf(null)).toBe('word')
    expect(kindOf(undefined)).toBe('word')
    expect(kindOf({ kind: 'idiom' })).toBe('idiom')
  })

  it('标签与顺序是 SSOT（视图直接引用，不许各写一份）', () => {
    expect(KIND_LABEL).toEqual({ word: '单词', phrase: '词组', idiom: '习语', usage: '用法' })
    expect(KIND_ORDER).toEqual(['word', 'phrase', 'idiom', 'usage'])
    expect(KIND_ORDER.map((k) => KIND_LABEL[k])).toEqual(['单词', '词组', '习语', '用法'])
  })
})

describe('分类判断', () => {
  const item = (kind?: VocabKind) => vocabItem(kind ? { kind } : {})

  it('isWordEntry / isLangPoint 互斥', () => {
    for (const k of KIND_ORDER) {
      const it = item(k)
      expect(isWordEntry(it)).toBe(k === 'word')
      expect(isLangPoint(it)).toBe(k !== 'word')
      expect(isWordEntry(it) !== isLangPoint(it)).toBe(true)
    }
  })

  it('isStudyable：只有用法笔记不能背/考', () => {
    expect(KIND_ORDER.map((k) => [k, isStudyable(item(k))])).toEqual([
      ['word', true],
      ['phrase', true],
      ['idiom', true],
      ['usage', false],
    ])
  })
})

describe('筛选', () => {
  const items = KIND_ORDER.map((k) => vocabItem({ id: `i-${k}`, word: `w-${k}`, lemma: `w-${k}`, kind: k }))

  it('filterByKind：不传 = 全部；传了就只留那几类', () => {
    expect(filterByKind(items)).toBe(items)
    expect(filterByKind(items, [])).toBe(items)
    expect(filterByKind(items, ['phrase', 'idiom']).map((it) => it.id)).toEqual(['i-phrase', 'i-idiom'])
    expect(filterByKind(items, ['usage']).map((it) => it.id)).toEqual(['i-usage'])
  })

  it('wordEntries / langEntries：单词 vs 语言点收藏', () => {
    expect(wordEntries(items).map((it) => it.id)).toEqual(['i-word'])
    expect(langEntries(items).map((it) => it.id)).toEqual(['i-phrase', 'i-idiom', 'i-usage'])
    expect(wordEntries(items).length + langEntries(items).length).toBe(items.length)
  })
})
