import { describe, expect, it } from 'vitest'
import { goldenSessionKey, isGoldenView, parseGoldenSession } from './goldenSession'

describe('golden session', () => {
  it('只认已知视图；未知 / 坏数据回落 null', () => {
    expect(parseGoldenSession({ view: 'bank', index: 2, recallIndex: 1 })).toEqual({ view: 'bank', index: 2, recallIndex: 1 })
    expect(parseGoldenSession({ view: 'unknown' })).toBeNull()
    expect(parseGoldenSession(null)).toBeNull()
    expect(parseGoldenSession('{"view":"home"}')).toBeNull()
    expect(isGoldenView('summary')).toBe(true)
    expect(isGoldenView('setup')).toBe(false)
  })

  it('索引脏值归零，不把界面卡到负数', () => {
    expect(parseGoldenSession({ view: 'drill', index: -3, recallIndex: 'x' })).toEqual({
      view: 'drill',
      index: 0,
      recallIndex: 0,
    })
  })

  it('会话键按文章隔离', () => {
    expect(goldenSessionKey('a@1')).toBe('reader:goldenSession:a@1')
    expect(goldenSessionKey(null)).toBe('reader:goldenSession:')
  })
})
