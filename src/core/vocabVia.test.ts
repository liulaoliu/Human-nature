import { describe, expect, it } from 'vitest'
import { isVocabVia, VOCAB_VIAS } from './vocabVia'

describe('isVocabVia：外部输入来源守卫', () => {
  it('合法来源全部放行', () => {
    for (const via of VOCAB_VIAS) expect(isVocabVia(via)).toBe(true)
  })

  it('未知字符串 / 非字符串一律拒绝', () => {
    expect(isVocabVia('乱写')).toBe(false)
    expect(isVocabVia('')).toBe(false)
    expect(isVocabVia(null)).toBe(false)
    expect(isVocabVia(1)).toBe(false)
  })
})
