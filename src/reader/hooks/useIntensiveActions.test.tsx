// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useIntensiveActions } from './useIntensiveActions'

function setup() {
  const deps = {
    openSpeedRead: vi.fn(),
    startStudy: vi.fn(),
    openWriting: vi.fn(),
    runAiLocal: vi.fn(),
    startQuizDrill: vi.fn(),
    startQuizArticleDrill: vi.fn(),
    drillLimit: 10,
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
    expect(deps.startQuizDrill).toHaveBeenCalledWith(['spell', 'meaning', 'choice'], 'article', {
      warmup: 'memory',
      limit: 10,
    })
  })

  it('记忆 / 词块拷打按面板设置的数量出题（其它拷打不受影响）', () => {
    const deps = {
      openSpeedRead: vi.fn(),
      startStudy: vi.fn(),
      openWriting: vi.fn(),
      runAiLocal: vi.fn(),
      startQuizDrill: vi.fn(),
      startQuizArticleDrill: vi.fn(),
      drillLimit: 20,
    }
    const { result } = renderHook(() => useIntensiveActions(deps))
    act(() => result.current.startIntensiveDrill('memory'))
    expect(deps.startQuizDrill).toHaveBeenLastCalledWith(['spell', 'meaning', 'choice'], 'article', {
      warmup: 'memory',
      limit: 20,
    })
    act(() => result.current.startIntensiveDrill('chunk'))
    expect(deps.startQuizDrill).toHaveBeenLastCalledWith(
      ['usage', 'cloze', 'collocation', 'prep', 'idiom'],
      'article',
      { warmup: 'chunk', limit: 20 },
    )
    act(() => result.current.startIntensiveDrill('deep'))
    expect(deps.startQuizDrill).toHaveBeenLastCalledWith(['define', 'defineChoice'], 'article')
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
      if (kind === 'chunk')
        expect(deps.startQuizDrill).toHaveBeenCalledWith(kinds, 'article', { warmup: 'chunk', limit: 10 })
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

  it('任何一档都不在动作里收面板（返回目标由路由的 ?back= 负责）', () => {
    const { result } = setup()
    act(() => result.current.startIntensiveDrill('listen'))
    // 没有可断言的关闭调用：动作签名里已经不再接收 setIntensiveOpen。
    expect(result.current.startIntensiveDrill).toBeTypeOf('function')
  })
})
