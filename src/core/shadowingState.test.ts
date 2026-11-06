import { describe, expect, it } from 'vitest'
import { parseCalibrationMap, parseScriptEditMap } from './shadowingState'

describe('shadowingState：localStorage 旧数据守卫', () => {
  it('校准：只留下形状正确的条目，坏字段丢弃', () => {
    const out = parseCalibrationMap({
      good: {
        offsetWords: 2,
        textStartChunk: 1,
        anchors: [
          { atSec: 1.5, startWord: 0, endWord: 2, text: 'hello world' },
          { atSec: 'x', startWord: 0, endWord: 2 },
        ],
        splits: [1, 'x', 2],
        merges: [3],
      },
      stringNumber: { offsetWords: '2', textStartChunk: 1 },
      missing: { offsetWords: 1 },
      nope: null,
    })
    expect(out).toEqual({
      good: {
        offsetWords: 2,
        textStartChunk: 1,
        anchors: [{ atSec: 1.5, startWord: 0, endWord: 2, text: 'hello world' }],
        splits: [1, 2],
        merges: [3],
      },
    })
    expect(parseCalibrationMap(null)).toEqual({})
    expect(parseCalibrationMap([])).toEqual({})
  })

  it('手动改文：只保留字符串值', () => {
    expect(parseScriptEditMap({ a: 'text', b: 2, c: null, d: '' })).toEqual({ a: 'text', d: '' })
    expect(parseScriptEditMap('nope')).toEqual({})
  })
})
