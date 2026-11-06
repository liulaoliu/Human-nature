import { describe, expect, it } from 'vitest'
import type { ProductionPrompt } from './production'
import {
  YOGURT_PARAGRAPH_ID,
  isYogurtPairPrompt,
  remapYogurtPrompts,
  yogurtPairsOf,
  yogurtTextKey,
} from './productionYogurt'

type Rows = Array<[string, string]>

function toPairs(rows: Rows) {
  return rows.map(([source, reference]) => ({ source, reference }))
}

function compile(rows: Rows, paragraph = false): ProductionPrompt[] {
  const result = remapYogurtPrompts([], 0, toPairs(rows), { paragraph })
  if (!result) throw new Error('应当能编译出 prompts')
  return result.prompts
}

const BASE: Rows = [
  ['今天下雨了。', 'It rained today.'],
  ['我没带伞。', 'I forgot my umbrella.'],
  ['只好打车。', 'So I took a taxi.'],
]

describe('yogurtPairsOf：从会话 prompts 反推断句', () => {
  it('逐句那一题变成对子，整段连写不算', () => {
    const prompts = compile(BASE, true)
    expect(prompts).toHaveLength(4)
    expect(yogurtPairsOf(prompts)).toEqual(toPairs(BASE))
    expect(isYogurtPairPrompt(prompts[0])).toBe(true)
    expect(prompts[3]?.id).toBe(YOGURT_PARAGRAPH_ID)
    expect(isYogurtPairPrompt(prompts[3])).toBe(false)
  })
})

describe('remapYogurtPrompts：中途改断句时保住进度', () => {
  it('对子没变就停在原题', () => {
    const prompts = compile(BASE)
    const result = remapYogurtPrompts(prompts, 2, toPairs(BASE))
    expect(result?.index).toBe(2)
    expect(result?.prompts.map((p) => p.id)).toEqual(prompts.map((p) => p.id))
  })

  it('删掉当前题之前的一对：题号跟着同一句前移', () => {
    const prompts = compile(BASE)
    const result = remapYogurtPrompts(prompts, 2, toPairs(BASE.slice(1)))
    expect(result?.index).toBe(1)
    expect(result?.prompts[1]?.zh).toBe('只好打车。')
  })

  it('当前这句被合并进上一对：退到原下标，不越界', () => {
    const prompts = compile(BASE)
    const merged: Rows = [
      ['今天下雨了。', 'It rained today.'],
      ['我没带伞。 只好打车。', 'I forgot my umbrella. So I took a taxi.'],
    ]
    const result = remapYogurtPrompts(prompts, 2, toPairs(merged))
    expect(result?.index).toBe(1)
    expect(result?.prompts).toHaveLength(2)
  })

  it('原来停在整段连写：改完断句仍停在整段', () => {
    const prompts = compile(BASE, true)
    const result = remapYogurtPrompts(prompts, 3, toPairs(BASE.slice(0, 2)), { paragraph: true })
    expect(result?.index).toBe(2)
    expect(result?.prompts[2]?.id).toBe(YOGURT_PARAGRAPH_ID)
  })

  it('一对有内容的都没有：返回 null，界面不该应用', () => {
    expect(remapYogurtPrompts(compile(BASE), 0, [{ source: '', reference: '' }])).toBeNull()
    expect(remapYogurtPrompts(compile(BASE), 0, [])).toBeNull()
  })

  it('句数对不上时把 warning 带回来', () => {
    const built = remapYogurtPrompts([], 0, toPairs(BASE), {
      direction: 'zh-en',
      warning: '3 句 / 2 句',
    })
    expect(built?.warning).toBe('3 句 / 2 句')
  })
})

describe('yogurtTextKey：比对用的键', () => {
  it('忽略首尾和连续空白，改动字词仍算不同', () => {
    expect(yogurtTextKey('  今天 下雨了。 ')).toBe('今天 下雨了。')
    expect(yogurtTextKey('今天下雨了。')).not.toBe(yogurtTextKey('昨天 下雨了。'))
  })
})
