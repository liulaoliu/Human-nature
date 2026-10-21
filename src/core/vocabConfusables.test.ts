import { describe, it, expect } from 'vitest'
import {
  VOCAB_CONFUSABLE_SOURCES,
  confusableSourceLabel,
  isVocabConfusableSource,
} from './vocabConfusables'

describe('vocabConfusables', () => {
  it('合法来源只有 AI / 离线词典', () => {
    expect(VOCAB_CONFUSABLE_SOURCES).toEqual(['ai', 'dict'])
    expect(isVocabConfusableSource('ai')).toBe(true)
    expect(isVocabConfusableSource('dict')).toBe(true)
  })

  it('旧数据 / 脏值不猜来源', () => {
    expect(isVocabConfusableSource(undefined)).toBe(false)
    expect(isVocabConfusableSource(null)).toBe(false)
    expect(isVocabConfusableSource('manual')).toBe(false)
  })

  it('标签：没记录来源时返回空串', () => {
    expect(confusableSourceLabel('ai')).toBe('AI')
    expect(confusableSourceLabel('dict')).toBe('词典')
    expect(confusableSourceLabel(undefined)).toBe('')
  })
})
