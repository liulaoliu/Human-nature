import { describe, expect, it } from 'vitest'
import { inDictionary } from './dictionary'

describe('inDictionary：连字符断词判断', () => {
  it('常见词（含大小写）在词典里', () => {
    expect(inDictionary('compared')).toBe(true)
    expect(inDictionary('Company')).toBe(true)
    expect(inDictionary('BETWEEN')).toBe(true)
  })

  it('查不到的词 → false（调用方据此保留连字符）', () => {
    expect(inDictionary('co-founder')).toBe(false)
    expect(inDictionary('zzzz')).toBe(false)
    expect(inDictionary('')).toBe(false)
  })
})
