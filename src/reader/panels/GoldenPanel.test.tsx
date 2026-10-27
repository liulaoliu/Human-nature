// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import GoldenPanel from './GoldenPanel'
import type { useGoldenDrill } from '../hooks/useGoldenDrill'

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
    render(<GoldenPanel api={api} articleTitle="A" onSpeak={vi.fn()} onExportMarkdown={vi.fn()} />)
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
    render(<GoldenPanel api={api} articleTitle="A" onSpeak={vi.fn()} onExportMarkdown={vi.fn()} />)
    expect((screen.getByText('遣词造句').closest('button') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('逆向回顾').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })
})
