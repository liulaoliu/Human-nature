// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import GoldenRecordDrawer from './GoldenRecordDrawer'
import { useHotkeys } from '../../useHotkeys'
import type { WritingRecord } from '../../../core/writing'

const record: WritingRecord = {
  at: '2026-10-01T00:00:00.000Z',
  articleId: 'a1',
  articleTitle: 'A',
  model: 'model',
  text: 'answer',
  feedback: { scores: [], total: 8, max: 10, issues: [], summary: '还行' },
  source: 'goldenSentence',
  sentenceId: 's1',
}

function LowerPriority({ onEscape }: { onEscape: () => void }) {
  useHotkeys(
    (e) => {
      if (e.key === 'Escape') onEscape()
    },
    true,
    45,
  )
  return null
}

describe('GoldenRecordDrawer：Esc 不再连带退出金句课', () => {
  it('抽屉优先级更高：Esc 只关抽屉', () => {
    const drawerClose = vi.fn()
    const lessonClose = vi.fn()
    render(
      <>
        <LowerPriority onEscape={lessonClose} />
        <GoldenRecordDrawer record={record} onClose={drawerClose} />
      </>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(drawerClose).toHaveBeenCalledTimes(1)
    expect(lessonClose).not.toHaveBeenCalled()
  })
})
