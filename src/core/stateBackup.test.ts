import { describe, it, expect } from 'vitest'
import { backupFileName, makeBackup, parseBackup } from './stateBackup'

describe('stateBackup', () => {
  it('makeBackup 打上 app/version 和导出时间', () => {
    const b = makeBackup({ 'shadowing.scripts.v1': '{"a":"b"}' }, 123)
    expect(b.app).toBe('shadowing')
    expect(b.version).toBe(1)
    expect(b.exportedAt).toBe(123)
    expect(b.data).toEqual({ 'shadowing.scripts.v1': '{"a":"b"}' })
  })

  it('parseBackup 能解析自己导出的内容', () => {
    const b = makeBackup({ 'shadowing.calibration.v1': '{"x":1}' }, 5)
    expect(parseBackup(JSON.stringify(b))).toEqual(b)
  })

  it('不是本工具的备份一律返回 null（不抛）', () => {
    expect(parseBackup('not json')).toBeNull()
    expect(parseBackup('123')).toBeNull()
    expect(parseBackup('{}')).toBeNull()
    expect(parseBackup(JSON.stringify({ app: 'other', data: {} }))).toBeNull()
    expect(parseBackup(JSON.stringify({ app: 'shadowing' }))).toBeNull()
    expect(parseBackup(JSON.stringify({ app: 'shadowing', data: 'x' }))).toBeNull()
  })

  it('只保留字符串值，脏数据不会漏进来', () => {
    const text = JSON.stringify({
      app: 'shadowing',
      version: 1,
      exportedAt: 9,
      data: { 'shadowing.a': 'ok', 'shadowing.b': 5, 'shadowing.c': null },
    })
    expect(parseBackup(text)?.data).toEqual({ 'shadowing.a': 'ok' })
  })

  it('备份文件名带日期', () => {
    expect(backupFileName(new Date('2026-09-28T12:00:00Z'))).toBe('shadowing-backup-2026-09-28.json')
  })
})
