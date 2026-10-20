// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { StudyDraft } from '../hooks/useStudyCardEdit'
import StudyEditForm from './StudyEditForm'

const draft: StudyDraft = {
  word: 'run',
  phonetic: '/rʌn/',
  partOfSpeech: 'v.',
  meaning: '跑',
  definition: '',
  usage: 'run out',
  phrases: '',
  idioms: '',
  grammarMarks: '',
}

describe('StudyEditForm：编辑表单', () => {
  it('字段受控，改动带出完整草稿', () => {
    const onDraftChange = vi.fn()
    render(<StudyEditForm draft={draft} onDraftChange={onDraftChange} onSave={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByDisplayValue('run'), { target: { value: 'sprint' } })
    expect(onDraftChange).toHaveBeenCalledWith({ ...draft, word: 'sprint' })
    fireEvent.change(screen.getByDisplayValue('跑'), { target: { value: '冲刺' } })
    expect(onDraftChange).toHaveBeenLastCalledWith({ ...draft, meaning: '冲刺' })
  })

  it('保存 / 取消走回调', () => {
    const onSave = vi.fn()
    const onCancel = vi.fn()
    render(<StudyEditForm draft={draft} onDraftChange={vi.fn()} onSave={onSave} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onSave).toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalled()
  })
})
