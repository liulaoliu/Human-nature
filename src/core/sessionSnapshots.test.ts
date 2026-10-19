import { describe, expect, it } from 'vitest'
import { parseDictSessionSnapshot, parseQuizSessionSnapshot } from './sessionSnapshots'

const q = {
  id: 'vocab:run:spell',
  itemId: 'vocab:run',
  lemma: 'run',
  kind: 'spell',
  word: 'run',
  prompt: '跑',
  meaning: '跑',
  partOfSpeech: 'v.',
  phonetic: null,
  answer: 'run',
  accept: ['run'],
}

describe('parseQuizSessionSnapshot', () => {
  it('合法快照原样恢复；index 越界收敛到队列末尾', () => {
    const s = parseQuizSessionSnapshot(
      JSON.stringify({ v: 1, queue: [q], index: 99, input: 'ru', checked: true, result: false, results: [{ id: q.id, itemId: q.itemId, correct: false }], autoRun: true }),
    )
    expect(s?.queue).toHaveLength(1)
    expect(s?.index).toBe(1)
    expect(s?.input).toBe('ru')
    expect(s?.checked).toBe(true)
    expect(s?.result).toBe(false)
    expect(s?.results).toEqual([{ id: q.id, itemId: q.itemId, correct: false }])
    expect(s?.autoRun).toBe(true)
  })

  it('坏题 / 未知题型被丢弃，好题保留；accept 空时补标准答案', () => {
    const s = parseQuizSessionSnapshot(
      JSON.stringify({
        v: 1,
        queue: [q, { ...q, id: '', kind: 'spell' }, { ...q, id: 'x', kind: 'nope' }, { ...q, id: 'y', accept: [] }],
        index: 0,
      }),
    )
    expect(s?.queue.map((x) => x.id)).toEqual([q.id, 'y'])
    expect(s?.queue[1].accept).toEqual(['run'])
  })

  it('不是 JSON / v 不对 / 队列空 / 全坏 → null（当没有快照）', () => {
    expect(parseQuizSessionSnapshot('{oops')).toBeNull()
    expect(parseQuizSessionSnapshot(null)).toBeNull()
    expect(parseQuizSessionSnapshot(JSON.stringify({ v: 2, queue: [q] }))).toBeNull()
    expect(parseQuizSessionSnapshot(JSON.stringify({ v: 1, queue: [] }))).toBeNull()
    expect(parseQuizSessionSnapshot(JSON.stringify({ v: 1, queue: [{ id: 1 }] }))).toBeNull()
  })

  it('局部坏字段用安全默认值（不整份失败）', () => {
    const s = parseQuizSessionSnapshot(JSON.stringify({ v: 1, queue: [q], index: 'x', input: 3, checked: 'yes', result: 'no', results: 'bad', autoRun: 1 }))
    expect(s).not.toBeNull()
    expect(s?.index).toBe(0)
    expect(s?.input).toBe('')
    expect(s?.checked).toBe(false)
    expect(s?.result).toBeNull()
    expect(s?.results).toEqual([])
    expect(s?.autoRun).toBe(false)
  })
})

const d = { id: 's1', text: 'Hello world.', targets: ['Hello'], sw: 0, ew: 1 }

describe('parseDictSessionSnapshot', () => {
  it('合法快照恢复；坏 diff 当作没有', () => {
    const s = parseDictSessionSnapshot(
      JSON.stringify({ v: 1, queue: [d], index: 1, mode: 'cloze', input: 'hi', checked: true, diff: [{ type: 'same', text: 'a' }, { type: 'bad', text: 'b' }], blanks: ['Hello'], results: [true], wrongItems: [], round: { offset: 2, grand: 10 } }),
    )
    expect(s?.queue).toEqual([d])
    expect(s?.index).toBe(1)
    expect(s?.mode).toBe('cloze')
    expect(s?.diff).toEqual([{ type: 'same', text: 'a' }])
    expect(s?.blanks).toEqual(['Hello'])
    expect(s?.results).toEqual([true])
    expect(s?.round).toEqual({ offset: 2, grand: 10 })
  })

  it('坏队列 / 坏条目被过滤；全坏 → null', () => {
    const s = parseDictSessionSnapshot(
      JSON.stringify({ v: 1, queue: [d, null, { id: '', text: 'x' }, { id: 's2' }], index: -5, mode: 'weird', round: { offset: 'x', grand: 1 } }),
    )
    expect(s?.queue).toEqual([d])
    expect(s?.index).toBe(0)
    expect(s?.mode).toBe('full')
    expect(s?.round).toEqual({ offset: 0, grand: 0 })
    expect(parseDictSessionSnapshot(JSON.stringify({ v: 1, queue: [{}] }))).toBeNull()
  })
})
