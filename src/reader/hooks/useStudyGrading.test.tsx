// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { vocabItem } from '../../core/testFixtures'
import { beginExtraRound, createLibrary, emptyExtraRound, type ExtraRound } from '../../core/vocab'
import type { VocabItem, VocabLibrary } from '../../types/document'
import { useStudyGrading } from './useStudyGrading'

/**
 * 判分的账本：一次判定要同时写库、计「今天引入」、计时、记活动、计数、重排。
 * 这四件事原来在 `useStudySession` 里抄了四遍，抽出来后在这里直接钉住。
 */

type Env = Parameters<typeof useStudyGrading>[0]
let api: ReturnType<typeof useStudyGrading> | null = null

/** 组一个只有 library 是真的、其余全是 spy 的环境。 */
function setup(items: VocabItem[], round: ExtraRound = beginExtraRound(items.map((it) => it.id))) {
  const env: Env = {
    library: { ...createLibrary(), items },
    extraRound: round,
    setExtraRound: vi.fn(),
    setQueue: vi.fn(),
    persist: vi.fn(),
    markStudied: vi.fn(),
    recordActivity: vi.fn(),
    addStudyTime: vi.fn(),
    flash: vi.fn(),
    onBumpNewToday: vi.fn(),
  }
  function Probe() {
    api = useStudyGrading(env)
    return null
  }
  render(<Probe />)
  return { env }
}

/** 在 act 里调一次账本方法（要 flush 状态更新），返回它的返回值。 */
function run<T>(fn: (a: NonNullable<typeof api>) => T): T {
  let out!: T
  act(() => {
    out = fn(api!)
  })
  return out
}

/** 从 persist 收到的最后一版词库里取某个词。 */
function persistedItem(env: Env, id: string): VocabItem | undefined {
  const calls = (env.persist as unknown as { mock: { calls: VocabLibrary[][] } }).mock.calls
  return calls.at(-1)?.[0].items.find((it) => it.id === id)
}

describe('useStudyGrading：评分记账', () => {
  it('评「忘记」：写库 + 计数 + 计时 + 记活动 + 进忘记账本 + 排到队尾', () => {
    const w = vocabItem({ id: 'w1', word: 'run', lemma: 'run', meaning: '跑' })
    const { env } = setup([w])

    run((a) => a.recordGrade('again', w))

    expect(env.persist).toHaveBeenCalledTimes(1)
    expect(persistedItem(env, 'w1')?.reviewState.lapses).toBe(1)
    expect(api!.counts).toEqual({ know: 0, fuzzy: 0, forgot: 1 })
    expect(api!.forgotCount).toBe(1)
    expect(api!.getForgotIds()).toEqual(['w1'])
    expect(env.addStudyTime).toHaveBeenCalledWith(0, 1)
    expect(env.markStudied).toHaveBeenCalledWith('w1')
    expect(env.recordActivity).toHaveBeenCalledWith('vocab', 1)
    // 忘记的卡本轮末尾再出现
    const append = (env.setQueue as unknown as { mock: { calls: [((q: VocabItem[] | null) => VocabItem[])][] } })
      .mock.calls[0][0]
    expect(append([w])).toEqual([w, w])
  })

  it('「新词今天已引入」只记一次：同一个词再判不再加', () => {
    const w = vocabItem({ id: 'w1', word: 'run', lemma: 'run' })
    const { env } = setup([w])

    run((a) => a.recordGrade('again', w))
    run((a) => a.recordGrade('good', w))

    expect(env.onBumpNewToday).toHaveBeenCalledTimes(1)
  })

  it('评「认识」不动忘记账本、不重排', () => {
    const w = vocabItem({ id: 'w1', word: 'run', lemma: 'run' })
    const { env } = setup([w])

    run((a) => a.recordGrade('good', w))

    expect(api!.counts).toEqual({ know: 1, fuzzy: 0, forgot: 0 })
    expect(api!.getForgotIds()).toEqual([])
    expect(env.setQueue).not.toHaveBeenCalled()
  })

  it('resetLedger 把计数与忘记账本一起归零', () => {
    const w = vocabItem({ id: 'w1', word: 'run', lemma: 'run' })
    setup([w])

    run((a) => a.recordGrade('again', w))
    run((a) => a.resetLedger())

    expect(api!.counts).toEqual({ know: 0, fuzzy: 0, forgot: 0 })
    expect(api!.forgotCount).toBe(0)
    expect(api!.getForgotIds()).toEqual([])
  })
})

describe('useStudyGrading：拼写与「不认识」', () => {
  it('拼错：判 again + 打「不认识」标签，并返回「已排到队尾」', () => {
    const w = vocabItem({ id: 'w1', word: 'run', lemma: 'run' })
    const { env } = setup([w])

    const requeued = run((a) => a.recordSpellingMiss(w))

    expect(requeued).toBe(true)
    expect(persistedItem(env, 'w1')?.tags).toContain('不认识')
    expect(api!.counts.forgot).toBe(1)
    expect(env.setQueue).toHaveBeenCalled()
  })

  it('组末拼错只记账不重排（那一轮是验收，不再本轮出场）', () => {
    const w = vocabItem({ id: 'w1', word: 'run', lemma: 'run' })
    const { env } = setup([w])

    run((a) => a.recordRoundTestMiss(w))

    expect(persistedItem(env, 'w1')?.tags).toContain('不认识')
    expect(api!.counts.forgot).toBe(1)
    expect(env.setQueue).not.toHaveBeenCalled()
  })

  it('标「不认识」：写 again + 打标签 + 进账本，但本轮不重排', () => {
    const w = vocabItem({ id: 'w1', word: 'run', lemma: 'run' })
    const { env } = setup([w])

    run((a) => a.recordUnknown(w))

    expect(persistedItem(env, 'w1')?.tags).toContain('不认识')
    expect(persistedItem(env, 'w1')?.reviewState.repetitions).toBe(0)
    expect(api!.getForgotIds()).toEqual(['w1'])
    expect(env.setQueue).not.toHaveBeenCalled()
    expect(env.flash).toHaveBeenCalled()
  })

  it('空账本也能直接 reset（重练前调用）', () => {
    const w = vocabItem({ id: 'w1', word: 'run', lemma: 'run' })
    setup([w], emptyExtraRound())

    run((a) => a.resetLedger())
    expect(api!.extraCount).toBe(0)
  })
})
