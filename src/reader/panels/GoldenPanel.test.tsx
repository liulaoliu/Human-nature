// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import GoldenPanel from './GoldenPanel'
import type { useGoldenDrill } from '../hooks/useGoldenDrill'
import type { GoldenBankRow } from '../../core/goldenBank'

function fakeApi(over: Record<string, unknown> = {}) {
  return {
    open: true,
    view: 'home',
    setView: vi.fn(),
    close: vi.fn(),
    doc: null,
    lesson: {
      version: 1,
      source: 'local',
      outline: [{ paraId: 'p01', role: 'intro', points: ['导入'] }],
      sentences: [],
      selected: [],
      options: { pick: 'recommended' },
    },
    ordered: [],
    candidates: [],
    summary: { selectedSentences: 0, masteredSentences: 0, totalTargets: 0, masteredTargets: 0, byKind: [], bySection: [] },
    progressFor: () => null,
    startDrill: vi.fn(),
    startRecall: vi.fn(),
    ...over,
  } as unknown as ReturnType<typeof useGoldenDrill>
}

describe('GoldenPanel', () => {
  it('课程页展示三个 STEP 和素材总结；点梳理思路切到选金句', () => {
    const api = fakeApi()
    render(<GoldenPanel api={api} articleTitle="A" onSpeak={vi.fn()} actions={{ onExportMarkdown: vi.fn() }} />)
    expect(screen.getByText('D老师小课堂')).toBeTruthy()
    expect(screen.getByText('梳理思路')).toBeTruthy()
    expect(screen.getByText('遣词造句')).toBeTruthy()
    expect(screen.getByText('逆向回顾')).toBeTruthy()
    expect(screen.getByText('本课素材总结')).toBeTruthy()
    fireEvent.click(screen.getByText('梳理思路'))
    expect(api.setView).toHaveBeenCalledWith('plan')
  })

  it('未选金句时，遣词造句 / 逆向回顾禁用', () => {
    const api = fakeApi()
    render(<GoldenPanel api={api} articleTitle="A" onSpeak={vi.fn()} actions={{ onExportMarkdown: vi.fn() }} />)
    expect((screen.getByText('遣词造句').closest('button') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('逆向回顾').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('全库金句本收一个 bank 对象，导出动作直接接上', () => {
    const api = fakeApi({ view: 'bank' })
    const rows = [{
      articleId: 'a1',
      articleTitle: 'A 篇',
      sentenceId: 's1',
      text: 'Team spirit is one of the main factors.',
      zh: '团队精神是主要因素之一。',
      targets: [],
      mastered: false,
      due: false,
    }] as GoldenBankRow[]
    const onExportMarkdown = vi.fn()
    render(
      <GoldenPanel
        api={api}
        articleTitle="A"
        onSpeak={vi.fn()}
        actions={{ onExportMarkdown: vi.fn(), bank: { rows, onExportMarkdown } }}
      />,
    )
    expect(screen.getByText('全库金句本')).toBeTruthy()
    expect(screen.getByText('Team spirit is one of the main factors.')).toBeTruthy()
    fireEvent.click(screen.getByText('导出 Markdown'))
    expect(onExportMarkdown).toHaveBeenCalled()
  })
})
