import { describe, it, expect, vi } from 'vitest'
import { CalibrationLedger } from './calibrationLedger'
import type { Calibration, CalibrationRepoPort, ManualAnchor } from '../core/ports'

function fakeRepo(initial: Record<string, Calibration> = {}) {
  const store = new Map(Object.entries(initial))
  const set = vi.fn((fileName: string, value: Calibration) => {
    store.set(fileName, value)
  })
  const repo: CalibrationRepoPort = { get: (f) => store.get(f), set }
  return { repo, set, store }
}

const anchor = (atSec: number, startWord: number, endWord: number): ManualAnchor => ({
  atSec,
  startWord,
  endWord,
  text: `w${startWord} w${endWord}`,
})

describe('CalibrationLedger 内存账本', () => {
  it('没读过就是默认值（平移 0 / 起点 0 / 没锚点没撕合）', () => {
    const l = new CalibrationLedger()
    expect(l.offsetOf('a.mp3')).toBe(0)
    expect(l.startOf('a.mp3')).toBe(0)
    expect(l.anchorsOf('a.mp3')).toEqual([])
    expect(l.splitsOf('a.mp3')).toEqual([])
    expect(l.mergesOf('a.mp3')).toEqual([])
    expect(l.editCountOf('a.mp3')).toBe(0)
  })

  it('按文件名分篇：改一篇不影响另一篇', () => {
    const l = new CalibrationLedger()
    l.setOffset('a.mp3', 3)
    l.setStart('b.mp3', 2)
    expect(l.offsetOf('a.mp3')).toBe(3)
    expect(l.offsetOf('b.mp3')).toBe(0)
    expect(l.startOf('a.mp3')).toBe(0)
    expect(l.startOf('b.mp3')).toBe(2)
  })

  it('撕合计数 = split 条数 + merge 条数', () => {
    const l = new CalibrationLedger()
    l.setSplits('a.mp3', [1, 2])
    l.setMerges('a.mp3', [3])
    expect(l.editCountOf('a.mp3')).toBe(3)
    l.clearEdits('a.mp3')
    expect(l.editCountOf('a.mp3')).toBe(0)
  })
})

describe('CalibrationLedger 持久化', () => {
  it('hydrate 把上次存的值读回来', () => {
    const { repo } = fakeRepo({
      'a.mp3': {
        offsetWords: 5,
        textStartChunk: 2,
        anchors: [anchor(0, 0, 3)],
        splits: [1.5],
        merges: [4],
      },
    })
    const l = new CalibrationLedger(repo)
    l.hydrate('a.mp3')
    expect(l.offsetOf('a.mp3')).toBe(5)
    expect(l.startOf('a.mp3')).toBe(2)
    expect(l.anchorsOf('a.mp3')).toHaveLength(1)
    expect(l.splitsOf('a.mp3')).toEqual([1.5])
    expect(l.mergesOf('a.mp3')).toEqual([4])
  })

  it('hydrate 没有记录时不改内存里的值', () => {
    const { repo } = fakeRepo()
    const l = new CalibrationLedger(repo)
    l.setOffset('a.mp3', 4)
    l.hydrate('a.mp3')
    expect(l.offsetOf('a.mp3')).toBe(4)
  })

  it('persist 写出的形状：空的那几项不占键（保持老记录形状）', () => {
    const { repo, set } = fakeRepo()
    const l = new CalibrationLedger(repo)
    l.setOffset('a.mp3', 2)
    l.persist('a.mp3')
    expect(set).toHaveBeenCalledWith('a.mp3', { offsetWords: 2, textStartChunk: 0 })
  })

  it('有锚点/撕合时一起写出去', () => {
    const { repo, set } = fakeRepo()
    const l = new CalibrationLedger(repo)
    l.setAnchors('a.mp3', [anchor(1, 0, 2)])
    l.setSplits('a.mp3', [3])
    l.setMerges('a.mp3', [4])
    l.persist('a.mp3')
    expect(set).toHaveBeenCalledWith('a.mp3', {
      offsetWords: 0,
      textStartChunk: 0,
      anchors: [anchor(1, 0, 2)],
      splits: [3],
      merges: [4],
    })
  })

  it('清空锚点后 persist 不再写 anchors 键', () => {
    const { repo, set } = fakeRepo()
    const l = new CalibrationLedger(repo)
    l.setAnchors('a.mp3', [anchor(1, 0, 2)])
    l.setAnchors('a.mp3', [])
    l.persist('a.mp3')
    expect(set).toHaveBeenCalledWith('a.mp3', { offsetWords: 0, textStartChunk: 0 })
  })

  it('clearAnchors 只删这一篇', () => {
    const l = new CalibrationLedger()
    l.setAnchors('a.mp3', [anchor(1, 0, 2)])
    l.setAnchors('b.mp3', [anchor(1, 0, 2)])
    l.clearAnchors('a.mp3')
    expect(l.anchorsOf('a.mp3')).toEqual([])
    expect(l.anchorsOf('b.mp3')).toHaveLength(1)
  })

  it('没注入仓储时 persist 不炸（隐私模式）', () => {
    const l = new CalibrationLedger()
    l.setOffset('a.mp3', 1)
    expect(() => l.persist('a.mp3')).not.toThrow()
  })

  it('没文件名（还没加载）时不写', () => {
    const { repo, set } = fakeRepo()
    new CalibrationLedger(repo).persist('')
    expect(set).not.toHaveBeenCalled()
  })
})
