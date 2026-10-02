import { describe, it, expect } from 'vitest'
import { cleanText, normalizeTypography } from './cleaner'

describe('normalizeTypography', () => {
  it('把 PDF 连字展成普通字母', () => {
    expect(normalizeTypography('Brie\ufb01ng O\ufb00shore')).toBe('Briefing Offshore')
  })

  it('删掉软连字符并直接接合', () => {
    expect(normalizeTypography('recent\u00adly')).toBe('recently')
  })

  it('不换行空格 / 窄空格变成普通空格', () => {
    expect(normalizeTypography('a\u00a0b\u202fc')).toBe('a b c')
  })

  it('统一换行符', () => {
    expect(normalizeTypography('a\r\nb\rc')).toBe('a\nb\nc')
  })
})

describe('cleanText', () => {
  it('行末连字符断词：去掉连字符后是词典里的词', () => {
    expect(cleanText('The com-\npared figures rose.')).toBe('The compared figures rose.')
  })

  it('行末连字符断词：真复合词保留连字符', () => {
    expect(cleanText('A co-\nfounder resigned.')).toBe('A co-founder resigned.')
  })

  it('段内硬换行用空格合并', () => {
    expect(cleanText('The quick brown\nfox jumps over\nthe lazy dog.')).toBe(
      'The quick brown fox jumps over the lazy dog.',
    )
  })

  it('句末标点后接大写不会把字符粘起来', () => {
    expect(cleanText('He left.\nNext day it rained.')).toBe('He left. Next day it rained.')
  })

  it('空行切段落', () => {
    expect(cleanText('First paragraph.\n\nSecond paragraph.')).toBe(
      'First paragraph.\n\nSecond paragraph.',
    )
  })

  it('连字符后是空行时不跨段合并', () => {
    expect(cleanText('end-\n\nstart')).toBe('end-\n\nstart')
  })

  it('空输入返回空串', () => {
    expect(cleanText('')).toBe('')
  })

  it('只有空白返回空串', () => {
    expect(cleanText('  \n\n \t \n')).toBe('')
  })

  it('单行且末尾无换行原样返回', () => {
    expect(cleanText('Just one line.')).toBe('Just one line.')
  })

  it('真实样本：2021 的软连字符', () => {
    expect(cleanText('Mississip\u00adpi’s literacy programme')).toBe(
      'Mississippi’s literacy programme',
    )
    expect(cleanText('af\u00adfordable housing')).toBe('affordable housing')
  })

  it('真实样本：ligature 混在正文里', () => {
    expect(cleanText('The ﬁrm said proﬁts ﬁrmed.')).toBe('The firm said profits firmed.')
  })

  it('幂等：洗两遍结果一样', () => {
    const once = cleanText('The com-\npared\n\nBrie\ufb01ng')
    expect(cleanText(once)).toBe(once)
  })
})
