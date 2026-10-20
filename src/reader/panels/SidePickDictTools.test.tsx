// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import SidePickDictTools, { type SidePickDictToolsProps } from './SidePickDictTools'

function props(over: Partial<SidePickDictToolsProps> = {}): SidePickDictToolsProps {
  return {
    dictReady: true,
    onRunAll: vi.fn(),
    dictBusy: false,
    onPickFromDict: vi.fn(),
    onEnrichFromDict: vi.fn(),
    onFixLemmasFromDict: vi.fn(),
    onConfuseFromDict: vi.fn(),
    examplesReady: true,
    onEnrichExamples: vi.fn(),
    ...over,
  }
}

describe('SidePickDictTools：离线词典/例句', () => {
  it('就绪状态可见；词典按钮走回调', () => {
    const onPickFromDict = vi.fn()
    render(<SidePickDictTools {...props({ onPickFromDict })} />)
    expect(screen.getByText(/已就绪（ECDICT）/)).toBeTruthy()
    expect(screen.getByText(/已就绪（Tatoeba/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '本篇挑词' }))
    expect(onPickFromDict).toHaveBeenCalled()
  })

  it('一键处理走回调；处理中所有按钮禁用', () => {
    const onRunAll = vi.fn()
    const { rerender } = render(<SidePickDictTools {...props({ onRunAll })} />)
    fireEvent.click(screen.getByRole('button', { name: /一键处理/ }))
    expect(onRunAll).toHaveBeenCalled()

    rerender(<SidePickDictTools {...props({ dictBusy: true })} />)
    expect(screen.getByRole('button', { name: '处理中…' })).toBeTruthy()
    for (const name of ['处理中…', '本篇挑词', '补齐生词本', '校正原形', '补混淆项', /补离线例句/]) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('词典未加载时四个词典按钮与一键处理禁用；补例句不受影响', () => {
    const onEnrichExamples = vi.fn()
    render(<SidePickDictTools {...props({ dictReady: false, examplesReady: false, onEnrichExamples })} />)
    for (const name of [/一键处理/, '本篇挑词', '补齐生词本', '校正原形', '补混淆项']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    }
    fireEvent.click(screen.getByRole('button', { name: /补离线例句/ }))
    expect(onEnrichExamples).toHaveBeenCalled()
  })
})
