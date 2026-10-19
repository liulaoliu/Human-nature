import { describe, expect, it } from 'vitest'
import {
  IMPORT_LEDGER_LIMIT,
  backupFingerprint,
  hasImported,
  parseImportLedger,
  rememberImport,
} from './importLedger'

describe('备份导入账本', () => {
  it('同一文本指纹相同，不同文本不同', () => {
    expect(backupFingerprint('{"a":1}')).toBe(backupFingerprint('{"a":1}'))
    expect(backupFingerprint('{"a":1}')).not.toBe(backupFingerprint('{"a":2}'))
  })

  it('记账去重、新的在前、封顶 20 条', () => {
    let ledger: string[] = []
    ledger = rememberImport(ledger, 'a')
    ledger = rememberImport(ledger, 'b')
    ledger = rememberImport(ledger, 'a')
    expect(ledger).toEqual(['a', 'b'])
    for (let i = 0; i < 30; i++) ledger = rememberImport(ledger, `x${i}`)
    expect(ledger).toHaveLength(IMPORT_LEDGER_LIMIT)
    expect(ledger[0]).toBe('x29')
    expect(hasImported(ledger, 'x29')).toBe(true)
    expect(hasImported(ledger, 'a')).toBe(false)
  })

  it('坏账本 / 非字符串项当空，不抛', () => {
    expect(parseImportLedger(null)).toEqual([])
    expect(parseImportLedger('{oops')).toEqual([])
    expect(parseImportLedger('{"a":1}')).toEqual([])
    expect(parseImportLedger('["a",1,null,"b"]')).toEqual(['a', 'b'])
  })
})
