import { describe, it, expect } from 'vitest'
import {
  dictMistake,
  listenMistake,
  mistakeCounts,
  removeMistake,
  upsertMistake,
  vocabMistake,
} from './mistakes'

describe('upsertMistake', () => {
  it('新增在前、同 id 累加', () => {
    let list = upsertMistake([], vocabMistake('vocab:run', 'run', 't1'))
    list = upsertMistake(list, vocabMistake('vocab:go', 'go', 't2'))
    list = upsertMistake(list, vocabMistake('vocab:run', 'run', 't3'))
    expect(list.map((m) => m.label)).toEqual(['go', 'run'])
    expect(list.find((m) => m.label === 'run')?.count).toBe(2)
  })
  it('按上限截断', () => {
    let list: ReturnType<typeof vocabMistake>[] = []
    for (let i = 0; i < 5; i++) list = upsertMistake(list, vocabMistake('vocab:' + i, 'w' + i, 't' + i), 3)
    expect(list).toHaveLength(3)
  })
})

describe('错题本：构造 / 计数 / 移除', () => {
  it('dict 同文本归一化后同一 id', () => {
    expect(dictMistake('The  Plan was', 't').id).toBe(dictMistake('the plan was', 't').id)
  })
  it('vocab / listen / dict 计数', () => {
    const q = { id: 'q1', type: 'gap' as const, stem: 's', answer: 'a' }
    const list = [vocabMistake('a', 'a', 't'), dictMistake('x', 't'), listenMistake('art', q, 't')]
    expect(mistakeCounts(list)).toEqual({ vocab: 1, listen: 1, dict: 1 })
  })
  it('remove 按 id 移除', () => {
    expect(removeMistake([vocabMistake('a', 'a', 't')], 'vocab:a')).toEqual([])
  })
})
