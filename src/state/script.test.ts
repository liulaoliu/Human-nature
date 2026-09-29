import { describe, it, expect } from 'vitest'
import { SessionStore } from './session'
import type {
  AudioPlayerPort,
  Calibration,
  CalibrationRepoPort,
  RecorderPort,
  ScriptEditRepoPort,
  ScriptRepoPort,
  TakeRepoPort,
} from '../core/ports'
import { buildSignal } from '../core/testSignals'
import { MIN_PIECE_SEC } from '../core/chunkEdits'

class FakePlayer implements AudioPlayerPort {
  duration = 0
  sampleRate = 0
  samples: Float32Array = new Float32Array(0)

  async load() {
    // 5 段 0.5s 语音，间隔 0.6s
    const s = buildSignal([
      ['speech', 0.5],
      ['silence', 0.6],
      ['speech', 0.6],
      ['silence', 0.6],
      ['speech', 0.5],
    ])
    this.samples = s.samples
    this.sampleRate = s.sampleRate
    this.duration = 2.7
  }
  async playRange() {}
  async playWhole() {}
  async playTake() {}
  pause() {}
  position = 0
  release() {}
  get isLoaded() {
    return true
  }
}

class FakeRecorder implements RecorderPort {
  async start() {}
  async stop() {
    return { blob: new Blob(['x']), mimeType: 'audio/webm', durationSec: 3.2 }
  }
  onLevel(_cb: (v: number) => void) {}
  release() {}
}

class FakeRepo implements TakeRepoPort {
  async save() {}
  async list() {
    return []
  }
  async remove() {}
  async clear() {}
}

function makeStore(
  scripts?: ScriptRepoPort,
  calibration?: CalibrationRepoPort,
  scriptEdits?: ScriptEditRepoPort,
) {
  const store = new SessionStore({
    player: new FakePlayer(),
    recorder: new FakeRecorder(),
    repo: new FakeRepo(),
    scripts,
    calibration,
    scriptEdits,
    abGapMs: 0,
  })
  return { store }
}

class FakeScriptRepo implements ScriptRepoPort {
  /** library=false 用来测「库没取到」那条路 */
  constructor(
    private book: Record<string, string> = {},
    private library = true,
  ) {}
  async find(fileName: string) {
    if (!this.library) return { text: null, library: false }
    return { text: this.book[fileName] ?? null, library: true }
  }
}

const blob = new Blob(['audio'])
const SCRIPT =
  'The Kenyan government has a problem. Its banks will not lend cheaply. ' +
  'Tired of asking nicely, the government has taken matters into its own hands. ' +
  'This month it will put a cap on commercial interest rates.'

describe('SessionStore 文本对齐', () => {
  it('没粘贴文本时 aligned 是空的', async () => {
    const { store } = makeStore()
    await store.load(blob, 'a.mp3')
    expect(store.getState().script).toBe('')
    expect(store.getState().aligned).toEqual([])
  })

  it('粘贴后每块都能拿到一段文字，长度和块数一致', async () => {
    const { store } = makeStore()
    await store.load(blob, 'a.mp3')
    store.setScript(SCRIPT)
    const s = store.getState()
    expect(s.script).toBe(SCRIPT)
    expect(s.aligned).toHaveLength(s.chunks.length)
    expect(s.aligned.every((a) => a.text.length > 0)).toBe(true)
  })

  it('aligned 的 index 就是块号，方便按 current 取', async () => {
    const { store } = makeStore()
    await store.load(blob, 'a.mp3')
    store.setScript(SCRIPT)
    const { aligned } = store.getState()
    expect(aligned.map((a) => a.index)).toEqual([0, 1, 2])
  })

  it('所有块的文字拼起来等于原文，不丢词不乱序', async () => {
    const { store } = makeStore()
    await store.load(blob, 'a.mp3')
    store.setScript(SCRIPT)
    const joined = store
      .getState()
      .aligned.map((a) => a.text)
      .join(' ')
      .split(/\s+/)
      .filter(Boolean)
    expect(joined).toEqual(SCRIPT.split(/\s+/).filter(Boolean))
  })

  it('清空文本会同时清掉对齐结果', async () => {
    const { store } = makeStore()
    await store.load(blob, 'a.mp3')
    store.setScript(SCRIPT)
    store.setScript('   ')
    expect(store.getState().script).toBe('   ')
    expect(store.getState().aligned).toEqual([])
  })

  it('改切块粒度后重新对齐，块数和文字数一起变', async () => {
    const { store } = makeStore()
    await store.load(blob, 'a.mp3')
    store.setScript(SCRIPT)
    const before = store.getState()
    store.setGranularity('long') // gap 更大 → 块变少
    const after = store.getState()
    expect(after.granularity).toBe('long')
    expect(after.chunks.length).toBeLessThan(before.chunks.length)
    expect(after.aligned).toHaveLength(after.chunks.length)
    const joined = after.aligned
      .map((a) => a.text)
      .join(' ')
      .split(/\s+/)
      .filter(Boolean)
    expect(joined).toEqual(SCRIPT.split(/\s+/).filter(Boolean))
  })

  it('换音频后旧文本的残留会被清掉', async () => {
    const { store } = makeStore()
    await store.load(blob, 'a.mp3')
    store.setScript(SCRIPT)
    await store.load(blob, 'b.mp3')
    expect(store.getState().script).toBe('')
    expect(store.getState().aligned).toEqual([])
  })

  it('文本比块数还少时也不崩，多出来的块留空', async () => {
    const { store } = makeStore()
    await store.load(blob, 'a.mp3')
    store.setScript('one two') // 2 词，3 块
    const { aligned, chunks } = store.getState()
    expect(aligned).toHaveLength(chunks.length)
    expect(aligned[0].text).not.toBe('')
    expect(aligned[1].text).not.toBe('')
    expect(aligned[2].text).toBe('')
  })
})

describe('SessionStore 自动带原文', () => {
  it('库里有这篇时，load 完就已经摊到块上，不用粘', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    const s = store.getState()
    expect(s.script).toBe(SCRIPT)
    expect(s.scriptSource).toBe('auto')
    expect(s.aligned).toHaveLength(s.chunks.length)
    expect(s.aligned.every((a) => a.text.length > 0)).toBe(true)
  })

  it('自动带进来的文本，词序和原文一致', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    const joined = store
      .getState()
      .aligned.map((a) => a.text)
      .join(' ')
      .split(/\s+/)
      .filter(Boolean)
    expect(joined).toEqual(SCRIPT.split(/\s+/).filter(Boolean))
  })

  it('库里没有这篇时，script 为空、来源是 none，页面还能手动粘', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'other.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    expect(store.getState().script).toBe('')
    expect(store.getState().scriptSource).toBe('none')
    expect(store.getState().aligned).toEqual([])
    expect(store.getState().scriptLibrary).toBe(true)
  })

  it('库整个没取到时，scriptLibrary 为 false（和「库里没这篇」区分开）', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }, false))
    await store.load(blob, 'a.mp3')
    expect(store.getState().script).toBe('')
    expect(store.getState().scriptLibrary).toBe(false)
    // 库没取到不该让整个页面失败
    expect(store.getState().status).toBe('ready')
  })

  it('没配原文库（scripts 不给）也不崩', async () => {
    const { store } = makeStore()
    await store.load(blob, 'a.mp3')
    expect(store.getState().status).toBe('ready')
    expect(store.getState().script).toBe('')
  })

  it('换了文件后自动换成新一篇的原文', async () => {
    const other = 'Completely different text for the second article here.'
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT, 'b.mp3': other }))
    await store.load(blob, 'a.mp3')
    expect(store.getState().script).toBe(SCRIPT)
    await store.load(blob, 'b.mp3')
    expect(store.getState().script).toBe(other)
  })

  it('手动改过的文本会盖掉自动带的，来源变成 manual', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    store.setScript('my own text')
    expect(store.getState().scriptSource).toBe('manual')
    expect(store.getState().script).toBe('my own text')
  })

  it('自动带的文本也跟着重新切块一起重算', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    store.setGranularity('long')
    const s = store.getState()
    expect(s.aligned).toHaveLength(s.chunks.length)
    const joined = s.aligned
      .map((a) => a.text)
      .join(' ')
      .split(/\s+/)
      .filter(Boolean)
    expect(joined).toEqual(SCRIPT.split(/\s+/).filter(Boolean))
  })
})

describe('SessionStore 文字偏移校准', () => {
  const joined = (store: SessionStore) =>
    store
      .getState()
      .aligned.map((a) => a.text)
      .join(' ')
      .split(/\s+/)
      .filter(Boolean)

  it('默认偏移是 0', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    expect(store.getState().offsetWords).toBe(0)
  })

  it('调偏移会重算对齐，但一个词都不丢', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    store.setOffsetWords(7)
    expect(store.getState().offsetWords).toBe(7)
    expect(joined(store)).toEqual(SCRIPT.split(/\s+/).filter(Boolean))
  })

  it('nudge 是累加的', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    store.nudgeOffsetWords(3)
    store.nudgeOffsetWords(3)
    store.nudgeOffsetWords(-15)
    expect(store.getState().offsetWords).toBe(-9)
  })

  it('平移量被夹在 ±总词数之间', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    const total = SCRIPT.split(/\s+/).filter(Boolean).length
    store.setOffsetWords(99999)
    expect(store.getState().offsetWords).toBe(total)
    store.setOffsetWords(-99999)
    expect(store.getState().offsetWords).toBe(-total)
  })

  it('偏移按篇记住：换走再换回来还在', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT, 'b.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    store.setOffsetWords(12)
    await store.load(blob, 'b.mp3')
    expect(store.getState().offsetWords).toBe(0) // b 还是默认
    await store.load(blob, 'a.mp3')
    expect(store.getState().offsetWords).toBe(12) // a 记住了
  })

  it('改切块粒度后偏移还在', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    store.setOffsetWords(5)
    store.setGranularity('long')
    expect(store.getState().offsetWords).toBe(5)
    expect(joined(store)).toEqual(SCRIPT.split(/\s+/).filter(Boolean))
  })
})

describe('SessionStore 正文起始块', () => {
  const joined = (store: SessionStore) =>
    store
      .getState()
      .aligned.map((a) => a.text)
      .join(' ')
      .split(/\s+/)
      .filter(Boolean)

  it('默认从头开始', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    expect(store.getState().textStartChunk).toBe(0)
    expect(store.getState().aligned[0].text).not.toBe('')
  })

  it('标了起点之后，前面的块空着，后面的块重新摊', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    store.setTextStartChunk(2)
    const s = store.getState()
    expect(s.textStartChunk).toBe(2)
    expect(s.aligned[0].text).toBe('')
    expect(s.aligned[1].text).toBe('')
    expect(s.aligned[2].text).not.toBe('')
  })

  it('标了起点之后「拼起来还是等于原文」，一个词不丢', async () => {
    for (const k of [0, 1, 2]) {
      const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
      await store.load(blob, 'a.mp3')
      store.setTextStartChunk(k)
      expect(joined(store), `start=${k}`).toEqual(SCRIPT.split(/\s+/).filter(Boolean))
    }
  })

  it('起点和整体偏移互不干扰，能一起用', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    store.setTextStartChunk(1)
    store.setOffsetWords(4)
    const s = store.getState()
    expect(s.textStartChunk).toBe(1)
    expect(s.offsetWords).toBe(4)
    expect(s.aligned[0].text).toBe('')
    expect(joined(store)).toEqual(SCRIPT.split(/\s+/).filter(Boolean))
  })

  it('起点按篇记住：换走再换回来还在', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT, 'b.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    store.setTextStartChunk(2)
    await store.load(blob, 'b.mp3')
    expect(store.getState().textStartChunk).toBe(0)
    await store.load(blob, 'a.mp3')
    expect(store.getState().textStartChunk).toBe(2)
  })

  it('起点被夹在合法范围内，不会把词全丢掉', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    const n = store.getState().chunks.length
    store.setTextStartChunk(999)
    expect(store.getState().textStartChunk).toBe(n - 1)
    expect(joined(store)).toEqual(SCRIPT.split(/\s+/).filter(Boolean))
    store.setTextStartChunk(-5)
    expect(store.getState().textStartChunk).toBe(0)
    expect(joined(store)).toEqual(SCRIPT.split(/\s+/).filter(Boolean))
  })

  it('取消起点后回到从头开始', async () => {
    const { store } = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }))
    await store.load(blob, 'a.mp3')
    store.setTextStartChunk(2)
    store.clearTextStart()
    expect(store.getState().textStartChunk).toBe(0)
    expect(store.getState().aligned[0].text).not.toBe('')
  })
})

/** 模拟 localStorage：同一个对象喂给两个 store，等价于「刷新后新建 store」 */
class FakeCalibration implements CalibrationRepoPort {
  map = new Map<string, Calibration>()
  get(fileName: string) {
    return this.map.get(fileName)
  }
  set(fileName: string, value: Calibration) {
    this.map.set(fileName, value)
  }
}

describe('SessionStore 校准持久化', () => {
  it('文字偏移和正文起点会落盘，刷新后新建 store 也读得回来', async () => {
    const cal = new FakeCalibration()
    const first = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }), cal).store
    await first.load(blob, 'a.mp3')
    first.setOffsetWords(9)
    first.setTextStartChunk(1)
    expect(cal.get('a.mp3')).toEqual({ offsetWords: 9, textStartChunk: 1 })

    // 刷新：全新 store，共用同一份存储
    const second = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }), cal).store
    await second.load(blob, 'a.mp3')
    expect(second.getState().offsetWords).toBe(9)
    expect(second.getState().textStartChunk).toBe(1)
    // 读回来的校准也要真的作用到对齐上，不只是显示
    expect(second.getState().aligned[0].text).toBe('')
  })

  it('「全部归零」会把 0 写回去，不只是内存里清一下', async () => {
    const cal = new FakeCalibration()
    const store = makeStore(new FakeScriptRepo({ 'a.mp3': SCRIPT }), cal).store
    await store.load(blob, 'a.mp3')
    store.setOffsetWords(6)
    store.clearTextStart()
    expect(cal.get('a.mp3')).toEqual({ offsetWords: 6, textStartChunk: 0 })
    store.setOffsetWords(0)
    expect(cal.get('a.mp3')).toEqual({ offsetWords: 0, textStartChunk: 0 })
  })

  it('不同篇各记各的，不会串', async () => {
    const cal = new FakeCalibration()
    const repo = new FakeScriptRepo({ 'a.mp3': SCRIPT, 'b.mp3': SCRIPT })
    const store = makeStore(repo, cal).store
    await store.load(blob, 'a.mp3')
    store.setOffsetWords(8)
    await store.load(blob, 'b.mp3')
    store.setOffsetWords(-4)
    await store.load(blob, 'a.mp3')
    expect(store.getState().offsetWords).toBe(8)
    expect(cal.get('b.mp3')?.offsetWords).toBe(-4)
  })
})

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
