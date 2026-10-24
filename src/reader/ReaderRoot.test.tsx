// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import ReaderRoot from './ReaderRoot'

const { hydrate } = vi.hoisted(() => ({ hydrate: vi.fn() }))

vi.mock('./learningState', () => ({ hydrateLearningFromServer: hydrate }))
vi.mock('./hooks/useLearningSync', () => ({ useLearningSync: () => undefined }))
vi.mock('./ReaderApp', () => ({ default: () => <div data-testid="reader-app">ReaderApp</div> }))

function deferred() {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  cleanup()
  hydrate.mockReset()
  vi.useRealTimers()
})

describe('ReaderRoot：先水合、再挂载', () => {
  it('本地已有记录也要等服务端水合完成，不能先初始化旧 state', async () => {
    const d = deferred()
    hydrate.mockReturnValue(d.promise)
    render(<ReaderRoot />)

    expect(screen.getByText('正在恢复学习记录…')).toBeTruthy()
    expect(screen.queryByTestId('reader-app')).toBeNull()

    await act(async () => {
      d.resolve()
      await d.promise
    })
    await waitFor(() => expect(screen.getByTestId('reader-app')).toBeTruthy())
    expect(screen.queryByText('正在恢复学习记录…')).toBeNull()
  })

  it('水合失败也要继续画（本地缓存兜底）', async () => {
    hydrate.mockRejectedValue(new Error('offline'))
    render(<ReaderRoot />)
    await waitFor(() => expect(screen.getByTestId('reader-app')).toBeTruthy())
  })

  it('服务端挂着不回：到超时时间先画，不能白屏', () => {
    vi.useFakeTimers()
    hydrate.mockReturnValue(new Promise<void>(() => undefined))
    render(<ReaderRoot />)

    expect(screen.queryByTestId('reader-app')).toBeNull()
    act(() => vi.advanceTimersByTime(3000))
    expect(screen.getByTestId('reader-app')).toBeTruthy()
  })
})
