import { describe, it, expect } from 'vitest'
import { vocabItem } from './testFixtures'
import {
  VOCAB_FIELDS,
  VOCAB_FIELD_SOURCES,
  fieldSourceLabel,
  isFieldLocked,
  isVocabField,
  isVocabFieldSource,
  normalizeVocabFieldSources,
} from './vocabFields'

describe('vocabFields', () => {
  it('只认四个核心字段与三种来源', () => {
    expect(VOCAB_FIELDS).toEqual(['phonetic', 'partOfSpeech', 'meaning', 'definition'])
    expect(VOCAB_FIELD_SOURCES).toEqual(['ai', 'dict', 'manual'])
    expect(isVocabField('meaning')).toBe(true)
    expect(isVocabField('confusables')).toBe(false)
    expect(isVocabFieldSource('dict')).toBe(true)
    expect(isVocabFieldSource('legacy')).toBe(false)
  })

  it('外部来源对象逐字段清洗，坏值不保留', () => {
    expect(normalizeVocabFieldSources({ meaning: 'ai', phonetic: 'bad', extra: 'manual' })).toEqual({
      meaning: 'ai',
    })
    expect(normalizeVocabFieldSources(null)).toBeUndefined()
    expect(normalizeVocabFieldSources(['ai'])).toBeUndefined()
    expect(normalizeVocabFieldSources({})).toBeUndefined()
  })

  it('新数据只锁手动改过的字段', () => {
    const it = vocabItem({ fieldSources: { meaning: 'manual', phonetic: 'ai' } })
    expect(isFieldLocked(it, 'meaning')).toBe(true)
    expect(isFieldLocked(it, 'phonetic')).toBe(false)
    expect(isFieldLocked(it, 'definition')).toBe(false)
  })

  it('旧数据没有 fieldSources：edited 仍整条锁；mastered 始终锁', () => {
    expect(isFieldLocked(vocabItem({ status: 'edited' }), 'meaning')).toBe(true)
    expect(isFieldLocked(vocabItem({ status: 'mastered', fieldSources: { meaning: 'ai' } }), 'meaning')).toBe(true)
    expect(isFieldLocked(vocabItem({ status: 'queried' }), 'meaning')).toBe(false)
  })

  it('标签：没记录来源时返回空串', () => {
    expect(fieldSourceLabel('ai')).toBe('AI')
    expect(fieldSourceLabel('dict')).toBe('词典')
    expect(fieldSourceLabel('manual')).toBe('手动')
    expect(fieldSourceLabel(undefined)).toBe('')
  })
})
