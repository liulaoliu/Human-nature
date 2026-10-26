import { describe, it, expect } from 'vitest'
import {
  KIND_LABEL,
  KIND_ORDER,
  filterByKind,
  inStudyDeck,
  isLangPoint,
  isSingleEnglishWord,
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

  it('单英文单词被标成语言点 → 仍按单词算（否则会从「本篇」消失）', () => {
    expect(isSingleEnglishWord('conglomerate')).toBe(true)
    expect(isSingleEnglishWord('take-off')).toBe(true)
    expect(isSingleEnglishWord("don't")).toBe(true)
    expect(isSingleEnglishWord('take off')).toBe(false)
    expect(isSingleEnglishWord('conglomerate 企业集团')).toBe(false)
    expect(isSingleEnglishWord('注意 purges 是名词')).toBe(false)
    expect(isSingleEnglishWord('')).toBe(false)

    expect(kindOf({ kind: 'usage', word: 'conglomerate' })).toBe('word')
    expect(kindOf({ kind: 'phrase', word: 'reckon' })).toBe('word')
    expect(kindOf({ kind: 'usage', word: 'conglomerate 企业集团' })).toBe('usage')
    expect(kindOf({ kind: 'phrase', word: 'fall back on' })).toBe('phrase')
    // 没有 word（只传 kind，测试/局部调用）时保持原类型
    expect(kindOf({ kind: 'usage' })).toBe('usage')
  })

  it('标签与顺序是 SSOT（视图直接引用，不许各写一份）', () => {
    expect(KIND_LABEL).toEqual({ word: '单词', phrase: '词组', idiom: '习语', usage: '用法' })
    expect(KIND_ORDER).toEqual(['word', 'phrase', 'idiom', 'usage'])
    expect(KIND_ORDER.map((k) => KIND_LABEL[k])).toEqual(['单词', '词组', '习语', '用法'])
  })
})

describe('分类判断', () => {
  // 类型要跟词形一致：单个英文单词本来就该是 word（见 kindOf 的兜底）。
  const shape: Record<VocabKind, string> = {
    word: 'test',
    phrase: 'run out',
    idiom: 'take its toll',
    usage: '注意 test 是名词',
  }
  const item = (kind?: VocabKind) => {
    const k = kind ?? 'word'
    return vocabItem({ kind, word: shape[k], lemma: shape[k].toLowerCase(), meaning: '义' })
  }

  it('isWordEntry / isLangPoint 互斥', () => {
    for (const k of KIND_ORDER) {
      const it = item(k)
      expect(isWordEntry(it)).toBe(k === 'word')
      expect(isLangPoint(it)).toBe(k !== 'word')
      expect(isWordEntry(it) !== isLangPoint(it)).toBe(true)
    }
  })

  it('isStudyable：用法笔记不能背/考；无释义的卡也不能（废卡先去补释义）', () => {
    expect(KIND_ORDER.map((k) => [k, isStudyable(item(k))])).toEqual([
      ['word', true],
      ['phrase', true],
      ['idiom', true],
      ['usage', false],
    ])
    // 无释义：普通单词 / 词组 / 习语都不该进背词 / 考试池
    expect(isStudyable(vocabItem({ kind: 'word', meaning: null }))).toBe(false)
    expect(isStudyable(vocabItem({ kind: 'phrase', meaning: null }))).toBe(false)
    expect(isStudyable(vocabItem({ kind: 'idiom', meaning: null }))).toBe(false)
    // 空串等价于无释义（displayMeaning 也会落到「无释义」）
    expect(isStudyable(vocabItem({ kind: 'word', meaning: '' }))).toBe(false)
  })

  it('inStudyDeck：背单词只收单词，背搭配只收词组/习语，用法两边都不进', () => {
    expect(KIND_ORDER.map((k) => [k, inStudyDeck(item(k), 'word')])).toEqual([
      ['word', true],
      ['phrase', false],
      ['idiom', false],
      ['usage', false],
    ])
    expect(KIND_ORDER.map((k) => [k, inStudyDeck(item(k), 'collocation')])).toEqual([
      ['word', false],
      ['phrase', true],
      ['idiom', true],
      ['usage', false],
    ])
  })
})

describe('筛选', () => {
  const items = [
    vocabItem({ id: 'i-word', word: 'test', lemma: 'test' }),
    vocabItem({ id: 'i-phrase', word: 'run out', lemma: 'run out', kind: 'phrase' }),
    vocabItem({ id: 'i-idiom', word: 'take its toll', lemma: 'take its toll', kind: 'idiom' }),
    vocabItem({ id: 'i-usage', word: '注意 test 是名词', lemma: '注意 test 是名词', kind: 'usage' }),
  ]
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
