// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useIntensiveActions } from './useIntensiveActions'

function setup() {
  const deps = {
    setIntensiveOpen: vi.fn(),
    openSpeedRead: vi.fn(),
    startStudy: vi.fn(),
    openWriting: vi.fn(),
    runAiLocal: vi.fn(),
    startQuizDrill: vi.fn(),
    startQuizArticleDrill: vi.fn(),
  }
  const { result } = renderHook(() => useIntensiveActions(deps))
  return { deps, result }
}

describe('useIntensiveActions（精读工作流入口）', () => {
  it('通读 / 达标拷打 / 产出 分别打开速读、背单词、仿写，并先收起面板', () => {
    const { deps, result } = setup()
    act(() => result.current.openIntensiveStage('skim'))
    expect(deps.setIntensiveOpen).toHaveBeenCalledWith(false)
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
      // 就地跑批：面板不关，进度和「取消」留在眼前（关掉再跑 = 点了没反应）
      expect(deps.setIntensiveOpen).not.toHaveBeenCalled()
    }
  })

  it('语法专项去练，不是去跑批：走文章级测验（和「快速拷打 → 语法」同一套）', () => {
    const { deps, result } = setup()
    act(() => result.current.openIntensiveStage('grammar'))
    expect(deps.startQuizArticleDrill).toHaveBeenCalledWith([
      'grammar',
      'phraseBlank',
      'translate2',
      'functionWord',
      'ordering',
    ])
    expect(deps.runAiLocal).not.toHaveBeenCalled()
  })

  it('拷打：记忆 = 拼写/选义/选择，走词级（本篇），并且先给预习卡', () => {
    const { deps, result } = setup()
    act(() => result.current.startIntensiveDrill('memory'))
    expect(deps.startQuizDrill).toHaveBeenCalledWith(['spell', 'meaning', 'choice'], 'article', { warmup: 'memory' })
  })

  it('拷打：词块 / 深度 / 标词 / 听力 各自的题型', () => {
    const cases: [Parameters<ReturnType<typeof setup>['result']['current']['startIntensiveDrill']>[0], string[]][] = [
      ['chunk', ['usage', 'cloze', 'collocation', 'prep', 'idiom']],
      ['deep', ['define', 'defineChoice']],
      ['mark', ['mark']],
      ['listen', ['listen']],
    ]
    for (const [kind, kinds] of cases) {
      const { deps, result } = setup()
      act(() => result.current.startIntensiveDrill(kind))
      // 只有「记忆 / 词块」两档先给预习卡（闭卷回忆，先认一遍再考）
      if (kind === 'chunk') expect(deps.startQuizDrill).toHaveBeenCalledWith(kinds, 'article', { warmup: 'chunk' })
      else expect(deps.startQuizDrill).toHaveBeenCalledWith(kinds, 'article')
    }
  })

  it('拷打：语法走文章级测验（句子题，不写 SRS）', () => {
    const { deps, result } = setup()
    act(() => result.current.startIntensiveDrill('grammar'))
    expect(deps.startQuizArticleDrill).toHaveBeenCalledWith([
      'grammar',
      'phraseBlank',
      'translate2',
      'functionWord',
      'ordering',
    ])
    expect(deps.startQuizDrill).not.toHaveBeenCalled()
  })

  it('任何一档都会先收起面板（不然盖住考题）', () => {
    const { deps, result } = setup()
    act(() => result.current.startIntensiveDrill('listen'))
    expect(deps.setIntensiveOpen).toHaveBeenCalledWith(false)
  })
})
