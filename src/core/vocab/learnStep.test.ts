import { describe, expect, it } from 'vitest'
import {
  LEARN_REVEAL_HOLD_MS,
  gradeLearnStep,
  meaningPassesOf,
  nextMeaningPasses,
  normPasses,
  recordLearnPass,
} from './learnStep'
import type { VocabItem, VocabLibrary } from '../../types/document'

function item(passes?: unknown): VocabItem {
  return {
    id: 'v1',
    word: 'abandon',
    lemma: 'abandon',
    phonetic: null,
    partOfSpeech: 'v.',
    meaning: '放弃',
    usage: [],
    examples: [],
    source: null,
    status: 'queried',
    note: '',
    tags: [],
    reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0, ...(passes != null ? { meaningPasses: passes } : {}) },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as VocabItem
}

function lib(passes?: unknown): VocabLibrary {
  return { items: [item(passes), { ...item(), id: 'v2', word: 'brave' }] as VocabItem[] } as VocabLibrary
}

describe('learnStep：学习模式「4 条释义」这一步的判定', () => {
  it('点了「看答案」：判不认识，先高亮停留再自动进单词卡', () => {
    const out = gradeLearnStep({ action: 'reveal', passes: 3, canQuiz: true })
    expect(out).toEqual({ kind: 'hold', grade: 'again', auto: true, wrong: false, label: expect.any(String) })
    // 停留时长是个可打断的常量，别写死在 UI 里
    expect(LEARN_REVEAL_HOLD_MS).toBeGreaterThan(0)
  })

  it('没看答案、选错：判不认识，停在释义页等「继续」（不自动进卡，且标出选错的那项）', () => {
    const out = gradeLearnStep({ action: 'wrong', passes: 0, canQuiz: true })
    expect(out).toEqual({ kind: 'hold', grade: 'again', auto: false, wrong: true, label: expect.any(String) })
  })

  it('没看答案、选对：首次判模糊（防蒙对），直接进单词卡', () => {
    const out = gradeLearnStep({ action: 'correct', passes: 0, canQuiz: true })
    expect(out).toEqual({ kind: 'card', grade: 'hard', pass: true, label: expect.any(String) })
  })

  it('没看答案、第二次选对：判认识', () => {
    expect(gradeLearnStep({ action: 'correct', passes: 1, canQuiz: true })).toMatchObject({ grade: 'good' })
    expect(gradeLearnStep({ action: 'correct', passes: 5, canQuiz: true })).toMatchObject({ grade: 'good' })
  })

  it('词库不够 4 个选项：不做判定，退回普通卡流程', () => {
    for (const action of ['reveal', 'correct', 'wrong'] as const) {
      expect(gradeLearnStep({ action, passes: 2, canQuiz: false })).toEqual({ kind: 'fallback' })
    }
  })
})

describe('learnStep：选对次数怎么记', () => {
  it('脏值一律按「没选对过」算', () => {
    expect(normPasses(undefined)).toBe(0)
    expect(normPasses(null)).toBe(0)
    expect(normPasses(NaN)).toBe(0)
    expect(normPasses(-1)).toBe(0)
    expect(normPasses(2.7)).toBe(2)
    expect(normPasses('3' as unknown as number)).toBe(0)
    expect(normPasses(4)).toBe(4)
  })

  it('选对 +1；判不认识归零（不再享受上次的信用）', () => {
    expect(nextMeaningPasses(0, true)).toBe(1)
    expect(nextMeaningPasses(2, true)).toBe(3)
    expect(nextMeaningPasses(2, false)).toBe(0)
    expect(nextMeaningPasses(undefined, false)).toBe(0)
  })

  it('从词条上读：老数据（没这个字段）按 0', () => {
    expect(meaningPassesOf(item())).toBe(0)
    expect(meaningPassesOf(item(3))).toBe(3)
  })
})

describe('learnStep：把次数写回词库', () => {
  it('选对写进 reviewState.meaningPasses，其它条目保持原引用', () => {
    const before = lib()
    const other = before.items[1]
    const after = recordLearnPass(before, 'v1', true, new Date('2026-05-05T00:00:00.000Z'))
    expect(after.items[0].reviewState.meaningPasses).toBe(1)
    expect(after.items[0].updatedAt).toBe('2026-05-05T00:00:00.000Z')
    expect(after.items[1]).toBe(other)
  })

  it('判不认识归零：记 0 时把字段摘掉（老数据口径：没有就是 0）', () => {
    const after = recordLearnPass(lib(3), 'v1', false)
    expect(after.items[0].reviewState.meaningPasses).toBeUndefined()
  })

  it('次数没变（比如 0 → 0）就原样返回，别白写一次词库', () => {
    const before = lib()
    expect(recordLearnPass(before, 'v1', false)).toBe(before)
  })

  it('找不到这个词就原样返回', () => {
    const before = lib()
    expect(recordLearnPass(before, 'nope', true)).toBe(before)
  })

  it('再次选对累加（第二次起才判认识）', () => {
    const once = recordLearnPass(lib(), 'v1', true)
    const twice = recordLearnPass(once, 'v1', true)
    expect(twice.items[0].reviewState.meaningPasses).toBe(2)
    expect(gradeLearnStep({ action: 'correct', passes: meaningPassesOf(twice.items[0]), canQuiz: true })).toMatchObject({
      grade: 'good',
    })
  })
})
