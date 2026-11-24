import { describe, expect, it } from 'vitest'
import { normalizeTextKey } from './textKey'

describe('normalizeTextKey：全库统一的文本比对键', () => {
  it('去首尾空白、折叠连续空白、转小写', () => {
    expect(normalizeTextKey('  Bad   TEMPEREDLY ')).toBe('bad temperedly')
    expect(normalizeTextKey('run')).toBe('run')
    expect(normalizeTextKey('')).toBe('')
  })

  it('标点与字母内容保持原样（只做空白与大小写归一）', () => {
    expect(normalizeTextKey('Take   its toll!')).toBe('take its toll!')
  })
})
