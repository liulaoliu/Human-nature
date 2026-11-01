// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  restore: vi.fn(),
}))
vi.mock('../../adapters/learningSnapshots', () => ({
  listLearningSnapshots: mocks.list,
  createLearningSnapshot: mocks.create,
  restoreLearningSnapshot: mocks.restore,
}))

import LearningSnapshots from './LearningSnapshots'

function openDetails(container: HTMLElement) {
  const details = container.querySelector('details')!
  details.open = true
  fireEvent(details, new Event('toggle'))
}

beforeEach(() => {
  mocks.list.mockReset()
  mocks.create.mockReset()
  mocks.restore.mockReset()
})

describe('LearningSnapshots', () => {
  it('展开才拉列表，按时间列出并标出来源', async () => {
    mocks.list.mockResolvedValue({
      snapshots: [
        { at: '2026-01-02T03:04:00.000Z', reason: 'auto', bytes: 2048 },
        { at: '2026-01-01T00:00:00.000Z', reason: 'manual', bytes: 1024 },
      ],
      dropped: 0,
    })
    const { container } = render(<LearningSnapshots />)
    expect(mocks.list).not.toHaveBeenCalled()
    openDetails(container)

    expect(await screen.findByRole('option', { name: /2026-01-02 03:04 · 自动/ })).toBeTruthy()
    expect(screen.getByRole('option', { name: /2026-01-01 00:00 · 手动/ })).toBeTruthy()
  })

  it('拍一张：创建后刷新列表并提示', async () => {
    mocks.list.mockResolvedValue({ snapshots: [], dropped: 0 })
    mocks.create.mockResolvedValue('2026-01-03T00:00:00.000Z')
    const { container } = render(<LearningSnapshots />)
    openDetails(container)
    await screen.findByRole('option', { name: '还没有快照' })

    fireEvent.click(screen.getByRole('button', { name: '现在拍一张' }))
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText(/已保存 2026-01-03 00:00/)).toBeTruthy())
  })

  it('恢复：确认后调用 restore，并通知外层重新加载', async () => {
    mocks.list.mockResolvedValue({
      snapshots: [{ at: '2026-01-02T03:04:00.000Z', reason: 'auto', bytes: 10 }],
      dropped: 0,
    })
    mocks.restore.mockResolvedValue(undefined)
    const onRestored = vi.fn()
    const confirm = vi.fn(() => true)
    const { container } = render(<LearningSnapshots onRestored={onRestored} confirm={confirm} />)
    openDetails(container)
    const option = await screen.findByRole('option', { name: /自动/ })

    fireEvent.change(screen.getByLabelText('选择要恢复的学习快照'), { target: { value: option.getAttribute('value') } })
    fireEvent.click(screen.getByRole('button', { name: '恢复' }))

    await waitFor(() => expect(mocks.restore).toHaveBeenCalledWith('2026-01-02T03:04:00.000Z'))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('2026-01-02 03:04'))
    expect(onRestored).toHaveBeenCalledTimes(1)
  })

  it('确认框点取消就不恢复', async () => {
    mocks.list.mockResolvedValue({
      snapshots: [{ at: '2026-01-02T03:04:00.000Z', reason: 'auto', bytes: 10 }],
      dropped: 0,
    })
    const { container } = render(<LearningSnapshots confirm={() => false} />)
    openDetails(container)
    const option = await screen.findByRole('option', { name: /自动/ })
    fireEvent.change(screen.getByLabelText('选择要恢复的学习快照'), { target: { value: option.getAttribute('value') } })
    fireEvent.click(screen.getByRole('button', { name: '恢复' }))
    expect(mocks.restore).not.toHaveBeenCalled()
  })

  it('服务不可用：给出可操作的提示，不把空列表当成功', async () => {
    mocks.list.mockRejectedValue(new Error('offline'))
    const { container } = render(<LearningSnapshots />)
    openDetails(container)
    expect(await screen.findByText(/本地存储服务不可用/)).toBeTruthy()
  })
})
