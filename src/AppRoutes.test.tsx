// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/** 单入口路由树：旧的跟读页已下线，`/` 只做一次跳转，真正画的是阅读页。 */
vi.mock('./reader/ReaderRoot', () => ({ default: () => <div>精读根组件</div> }))

import AppRoutes from './AppRoutes'

describe('AppRoutes：单入口', () => {
  it('/ 直接进阅读页（不留在空跳转页）', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    expect(await screen.findByText('精读根组件')).toBeTruthy()
  })

  it('/reader 与 /reader/** 画精读页（同一棵树，不整页刷新）', async () => {
    render(
      <MemoryRouter initialEntries={['/reader/a/my-article/p/study']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    expect(await screen.findByText('精读根组件')).toBeTruthy()
  })

  it('认不出的地址回阅读页', async () => {
    render(
      <MemoryRouter initialEntries={['/not-a-route']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    expect(await screen.findByText('精读根组件')).toBeTruthy()
  })
})
