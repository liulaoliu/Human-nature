import { describe, it, expect } from 'vitest'
import { MIN_PIECE_SEC } from '../core/chunkEdits'
import type { ScriptEditRepoPort } from '../core/ports'
import { FakeCalibration, FakeScriptRepo, SCRIPT, blob, makeStore } from './sessionTestFixtures'
import { SessionStore } from './session'

/**
 * 脚本的手工编辑：鼠标选字锚定、撕开 / 合并块、改文本后的持久化。
 */

describe('SessionStore 鼠标选字锚定', () => {
  const words = SCRIPT.split(/\s+/).filter(Boolean)
  const joined = (store: SessionStore) =>
    store.getState().aligned.map((a) => a.text).join(' ').split(/\s+/).filter(Boolean)

  it('选字后当前块刚好拿到选中的词，拼起来还是原文', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    store.select(1)
    store.setAnchorWords(5, 12)
    const s = store.getState()
    expect(s.manualAnchors).toBe(1)
    expect(s.aligned[1].wordRange).toEqual([5, 12])
    expect(joined(store)).toEqual(words)
  })

  it('同一块重选覆盖，不会越堆越多', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    store.select(1)
    store.setAnchorWords(0, 5)
    store.setAnchorWords(2, 8)
    expect(store.getState().manualAnchors).toBe(1)
    expect(store.getState().aligned[1].wordRange).toEqual([2, 8])
  })

  it('不同块各锚一个，两个锚点共存', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    store.select(1)
    store.setAnchorWords(0, 5)
    store.select(2)
    store.setAnchorWords(5, 11)
    const s = store.getState()
    expect(s.manualAnchors).toBe(2)
    expect(s.aligned[1].wordRange).toEqual([0, 5])
    expect(s.aligned[2].wordRange[0]).toBe(5)
    expect(joined(store)).toEqual(words)
  })

  it('清除锚定后回到纯按比例', async () => {
    const plain = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT })).store
    await plain.load(blob, 'a.mp3')
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    store.select(1)
    store.setAnchorWords(5, 12)
    store.clearAnchors()
    expect(store.getState().manualAnchors).toBe(0)
    expect(store.getState().aligned).toEqual(plain.getState().aligned)
  })

  it('锚点落盘，刷新后新建 store 读得回来', async () => {
    const cal = new FakeCalibration()
    const first = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }), cal).store
    await first.load(blob, 'a.mp3')
    first.select(1)
    first.setAnchorWords(5, 12)
    // 记下了选中的原文，改文本时才有得比对
    expect(cal.get('a.mp3')?.anchors?.[0].text).toBe(words.slice(5, 12).join(' '))

    const second = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }), cal).store
    await second.load(blob, 'a.mp3')
    expect(second.getState().manualAnchors).toBe(1)
    expect(second.getState().aligned[1].wordRange).toEqual([5, 12])
  })

  it('nudgeAnchor 调开头/结尾，并同步更新记下的文字', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    store.select(1)
    store.setAnchorWords(5, 12)
    store.nudgeAnchor('start', 1)
    expect(store.getState().manualRanges[0].startWord).toBe(6)
    store.nudgeAnchor('end', -1)
    expect(store.getState().manualRanges[0].endWord).toBe(11)
    // 还是「拼起来等于原文」
    expect(joined(store)).toEqual(words)
  })

  it('nudgeAnchor 不会让开头越过结尾', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    store.select(1)
    store.setAnchorWords(5, 7)
    store.nudgeAnchor('start', 99)
    expect(store.getState().manualRanges[0].startWord).toBe(6)
    store.nudgeAnchor('end', -99)
    expect(store.getState().manualRanges[0].endWord).toBe(7)
  })

  it('当前块没锚定时，nudge 会先按现有对齐钉一个', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    store.select(1)
    expect(store.getState().manualAnchors).toBe(0)
    const wr = store.getState().aligned[1].wordRange
    store.nudgeAnchor('start', 1)
    const s = store.getState()
    expect(s.manualAnchors).toBe(1)
    expect(s.manualRanges[0].chunkIndex).toBe(1)
    expect(s.manualRanges[0].startWord).toBe(wr[0] + 1)
  })

  it('clearAnchorHere 只去掉当前块', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    store.select(1)
    store.setAnchorWords(0, 5)
    store.select(2)
    store.setAnchorWords(5, 11)
    store.select(1)
    store.clearAnchorHere()
    const s = store.getState()
    expect(s.manualAnchors).toBe(1)
    expect(s.manualRanges[0].chunkIndex).toBe(2)
  })

  it('改文本后锚点按记下的文字重新定位，进度不白标', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    store.select(1)
    store.setAnchorWords(5, 12)
    const before = store.getState().manualRanges[0]

    // 在正文最前面补两个词（相当于改掉一处识别错漏）
    store.setScript('EXTRA WORDS ' + SCRIPT)
    const after = store.getState().manualRanges[0]
    expect(after.startWord).toBe(before.startWord + 2)
    expect(after.endWord).toBe(before.endWord + 2)
    // 对齐也按新文本算
    const editedWords = ('EXTRA WORDS ' + SCRIPT).split(/\s+/).filter(Boolean)
    expect(joined(store)).toEqual(editedWords)
  })
})

class FakeScriptEdit implements ScriptEditRepoPort {
  map = new Map<string, string>()
  get(fileName: string) {
    return this.map.get(fileName)
  }
  set(fileName: string, text: string) {
    this.map.set(fileName, text)
  }
  remove(fileName: string) {
    this.map.delete(fileName)
  }
}

describe('SessionStore 手动撕开 / 合并块', () => {
  const joined = (store: SessionStore) =>
    store.getState().aligned.map((a) => a.text).join(' ').split(/\s+/).filter(Boolean)

  it('撕开当前块后多出一块，current 不变', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    const before = store.getState().chunks
    const c = before[1]
    store.select(1)
    store.splitCurrentChunk((c.start + c.end) / 2)
    const after = store.getState().chunks
    expect(after).toHaveLength(before.length + 1)
    expect(store.getState().current).toBe(1)
    // 原块被一分为二，边界对得上
    expect(after[1].start).toBeCloseTo(c.start, 6)
    expect(after[1].end).toBeCloseTo(after[2].start, 6)
    expect(after[2].end).toBeCloseTo(c.end, 6)
    expect(store.getState().splitPoints).toHaveLength(1)
  })

  it('连续撕多刀，块数累加（走快路径也不丢之前的刀口）', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    const c0 = store.getState().chunks[0]
    const n = store.getState().chunks.length
    // 在第一块里连撕两刀
    store.splitCurrentChunk(c0.start + (c0.end - c0.start) / 3)
    store.splitCurrentChunk(c0.start + (2 * (c0.end - c0.start)) / 3)
    const after = store.getState().chunks
    expect(after).toHaveLength(n + 2)
    expect(store.getState().chunkEditCount).toBe(2)
    expect(joined(store)).toEqual(SCRIPT.split(/\s+/).filter(Boolean))
  })

  it('撕开后「拼起来等于原文」不受影响', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    const c = store.getState().chunks[0]
    store.splitCurrentChunk((c.start + c.end) / 2)
    expect(joined(store)).toEqual(SCRIPT.split(/\s+/).filter(Boolean))
  })

  it('刀口贴边时会被夹开，至少留出最小片段', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    const n = store.getState().chunks.length
    const c = store.getState().chunks[0]
    store.splitCurrentChunk(c.start + 0.001)
    const after = store.getState().chunks
    expect(after).toHaveLength(n + 1)
    expect(after[0].end - after[0].start).toBeCloseTo(MIN_PIECE_SEC, 3)
    expect(store.getState().chunkEditCount).toBe(1)
  })

  it('合并下一块回到撕开前', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    const before = store.getState().chunks
    const c = before[1]
    store.select(1)
    store.splitCurrentChunk((c.start + c.end) / 2)
    expect(store.getState().chunks).toHaveLength(before.length + 1)
    store.mergeCurrentWithNext()
    const after = store.getState().chunks
    expect(after).toHaveLength(before.length)
    expect(after[1].end).toBeCloseTo(c.end, 6)
    expect(joined(store)).toEqual(SCRIPT.split(/\s+/).filter(Boolean))
    // 撤销一次撕开不该留下「已手动切分」的计数
    expect(store.getState().chunkEditCount).toBe(0)
    expect(store.getState().splitPoints).toHaveLength(0)
  })

  it('合并相邻的两块（撤销时是 merge），落盘且刷新后还在', async () => {
    const cal = new FakeCalibration()
    const repo = new FakeScriptRepo({ 'a.mp3': SCRIPT })
    const first = makeStore(repo, cal).store
    await first.load(blob, 'a.mp3')
    const before = first.getState().chunks
    expect(before.length).toBeGreaterThanOrEqual(3)
    first.select(1)
    first.mergeCurrentWithNext()
    const after = first.getState().chunks
    expect(after).toHaveLength(before.length - 1)
    expect(after[1].end).toBeCloseTo(before[2].end, 6)
    expect(first.getState().chunkEditCount).toBe(1)
    expect(cal.get('a.mp3')?.merges).toHaveLength(1)
    expect(joined(first)).toEqual(SCRIPT.split(/\s+/).filter(Boolean))

    const second = makeStore(repo, cal).store
    await second.load(blob, 'a.mp3')
    expect(second.getState().chunks).toHaveLength(before.length - 1)
    expect(second.getState().chunkEditCount).toBe(1)
  })

  it('撕开的刀口落盘，刷新后新建 store 还在', async () => {
    const cal = new FakeCalibration()
    const first = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }), cal).store
    await first.load(blob, 'a.mp3')
    const c = first.getState().chunks[1]
    first.select(1)
    first.splitCurrentChunk((c.start + c.end) / 2)
    expect(cal.get('a.mp3')?.splits).toHaveLength(1)

    const second = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }), cal).store
    await second.load(blob, 'a.mp3')
    expect(second.getState().chunkEditCount).toBe(1)
    expect(second.getState().chunks).toHaveLength(first.getState().chunks.length)
  })

  it('重置手动切分后回到纯 VAD', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    const n = store.getState().chunks.length
    const c = store.getState().chunks[1]
    store.select(1)
    store.splitCurrentChunk((c.start + c.end) / 2)
    expect(store.getState().chunkEditCount).toBe(1)
    store.resetChunkEdits()
    expect(store.getState().chunkEditCount).toBe(0)
    expect(store.getState().splitPoints).toHaveLength(0)
    expect(store.getState().chunks).toHaveLength(n)
  })

  it('撕开带锚点的块：锚点按比例拆成两个，两半都有字', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    store.select(1)
    store.setAnchorWords(5, 12)
    const c = store.getState().chunks[1]
    store.splitCurrentChunk((c.start + c.end) / 2)
    const s = store.getState()
    expect(s.manualAnchors).toBe(2)
    // 两个锚点合起来还是原来那 7 个词
    const ranges = s.manualRanges.map((r) => [r.startWord, r.endWord]).sort((a, b) => a[0] - b[0])
    expect(ranges[0][0]).toBe(5)
    expect(ranges.at(-1)![1]).toBe(12)
    expect(ranges[0][1]).toBe(ranges[1][0])
    expect(joined(store)).toEqual(SCRIPT.split(/\s+/).filter(Boolean))
  })

  it('改切块粒度后手动撕开还在', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    const c = store.getState().chunks[1]
    store.select(1)
    store.splitCurrentChunk((c.start + c.end) / 2)
    store.setGranularity('long')
    expect(store.getState().chunkEditCount).toBe(1)
    expect(joined(store)).toEqual(SCRIPT.split(/\s+/).filter(Boolean))
  })
})

describe('SessionStore 改文本持久化', () => {
  it('改过的文本刷新后还在，不会被原文库覆盖', async () => {
    const edits = new FakeScriptEdit()
    const lib = new FakeScriptRepo({ 'a.mp3': SCRIPT })
    const first = makeStore(lib, undefined, edits).store
    await first.load(blob, 'a.mp3')
    expect(first.getState().scriptSource).toBe('auto')

    first.setScript('EDITED TEXT ONLY.')
    expect(edits.get('a.mp3')).toBe('EDITED TEXT ONLY.')

    // 刷新：新 store，共用同一份改动
    const second = makeStore(lib, undefined, edits).store
    await second.load(blob, 'a.mp3')
    expect(second.getState().script).toBe('EDITED TEXT ONLY.')
    expect(second.getState().scriptSource).toBe('manual')
  })

  it('清空文本会删掉改动，下次回原文库', async () => {
    const edits = new FakeScriptEdit()
    const lib = new FakeScriptRepo({ 'a.mp3': SCRIPT })
    const store = makeStore(lib, undefined, edits).store
    await store.load(blob, 'a.mp3')
    store.setScript('X Y Z.')
    store.clearScript()
    expect(edits.get('a.mp3')).toBeUndefined()

    const again = makeStore(lib, undefined, edits).store
    await again.load(blob, 'a.mp3')
    expect(again.getState().script).toBe(SCRIPT)
    expect(again.getState().scriptSource).toBe('auto')
  })

  it('别人不改文本时，原文库照常自动带上', async () => {
    const edits = new FakeScriptEdit()
    const store = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }), undefined, edits).store
    await store.load(blob, 'a.mp3')
    expect(store.getState().script).toBe(SCRIPT)
    expect(store.getState().scriptSource).toBe('auto')
  })
})
