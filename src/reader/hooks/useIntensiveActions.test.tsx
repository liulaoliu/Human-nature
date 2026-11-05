// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_DRILL_LIMITS } from '../../core/intensiveDrill'
import { useIntensiveActions } from './useIntensiveActions'

const GRAMMAR_KINDS = ['grammar', 'phraseBlank', 'translate2', 'functionWord', 'ordering']

function setup(over: Partial<Parameters<typeof useIntensiveActions>[0]> = {}) {
  const deps = {
    openSpeedRead: vi.fn(),
    startStudy: vi.fn(),
    openWriting: vi.fn(),
    runAiLocal: vi.fn(),
    startQuizDrill: vi.fn(),
    startQuizArticleDrill: vi.fn(),
    drillLimits: { ...DEFAULT_DRILL_LIMITS },
    ...over,
  }
  const { result } = renderHook(() => useIntensiveActions(deps))
  return { deps, result }
}

describe('useIntensiveActions（精读工作流入口）', () => {
  it('通读 / 达标拷打 / 产出 分别打开速读、背单词、仿写，面板留给路由关', () => {
    const { deps, result } = setup()
    act(() => result.current.openIntensiveStage('skim'))
    expect(deps.openSpeedRead).toHaveBeenCalled()

    act(() => result.current.openIntensiveStage('recall'))
    expect(deps.startStudy).toHaveBeenCalled()

    act(() => result.current.openIntensiveStage('produce'))
    expect(deps.openWriting).toHaveBeenCalled()
  })

  it('标词 / 词块 / 理解 交给一键跑批（一次补齐音标·释义·例句·词组·语言点）', () => {
    for (const stage of ['vocab', 'chunks', 'comprehend'] as const) {
      const { deps, result } = setup()
      act(() => result.current.openIntensiveStage(stage))
      expect(deps.runAiLocal).toHaveBeenCalledTimes(1)
      expect(deps.startQuizArticleDrill).not.toHaveBeenCalled()
    }
  })

  it('语法专项去练，不是去跑批：走文章级测验，并沿用「语法·结构」记住的题数', () => {
    const { deps, result } = setup({
      drillLimits: { ...DEFAULT_DRILL_LIMITS, grammar: 25 },
    })
    act(() => result.current.openIntensiveStage('grammar'))
    expect(deps.startQuizArticleDrill).toHaveBeenCalledWith(GRAMMAR_KINDS, 25)
    expect(deps.runAiLocal).not.toHaveBeenCalled()
  })

  it('记忆 / 词块：按各自数量出题，并先给预习卡', () => {
    const { deps, result } = setup()
    act(() => result.current.startIntensiveDrill('memory', 20))
    expect(deps.startQuizDrill).toHaveBeenLastCalledWith(['spell', 'meaning', 'choice'], 'article', {
      warmup: 'memory',
      limit: 20,
    })

    act(() => result.current.startIntensiveDrill('chunk', 5))
    expect(deps.startQuizDrill).toHaveBeenLastCalledWith(
      ['usage', 'cloze', 'collocation', 'prep', 'idiom'],
      'article',
      { warmup: 'chunk', limit: 5 },
    )
  })

  it('英英释义 / 语法标记 / 听力：直接开考，数量各自传入', () => {
    const cases: [
      Parameters<ReturnType<typeof setup>['result']['current']['startIntensiveDrill']>[0],
      string[],
    ][] = [
      ['deep', ['define', 'defineChoice']],
      ['mark', ['mark']],
      ['listen', ['listen']],
    ]
    for (const [kind, kinds] of cases) {
      const { deps, result } = setup()
      act(() => result.current.startIntensiveDrill(kind, 15))
      expect(deps.startQuizDrill).toHaveBeenCalledWith(kinds, 'article', { limit: 15 })
      expect(deps.startQuizArticleDrill).not.toHaveBeenCalled()
    }
  })

  it('语法·结构走文章级测验（句子题，不写 SRS），数量单独传入', () => {
    const { deps, result } = setup()
    act(() => result.current.startIntensiveDrill('grammar', 30))
    expect(deps.startQuizArticleDrill).toHaveBeenCalledWith(GRAMMAR_KINDS, 30)
    expect(deps.startQuizDrill).not.toHaveBeenCalled()
  })
})
