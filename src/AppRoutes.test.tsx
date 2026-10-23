// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/** 单入口路由树：`/` 与 `/reader/**` 在同一个 Router 里，各画各的根组件。 */
vi.mock('./ui/App', () => ({ default: () => <div>跟读根组件</div> }))
vi.mock('./reader/ReaderRoot', () => ({ default: () => <div>精读根组件</div> }))

import AppRoutes from './AppRoutes'

describe('AppRoutes：单入口', () => {
  it('/ 画跟读页', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    expect(await screen.findByText('跟读根组件')).toBeTruthy()
  })

  it('/reader 与 /reader/** 画精读页（同一棵树，不整页刷新）', async () => {
    render(
      <MemoryRouter initialEntries={['/reader/a/my-article/p/study']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    expect(await screen.findByText('精读根组件')).toBeTruthy()
  })

  it('认不出的地址回首页', async () => {
    render(
      <MemoryRouter initialEntries={['/not-a-route']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    expect(await screen.findByText('跟读根组件')).toBeTruthy()
  })
})
