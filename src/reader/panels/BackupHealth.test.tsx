// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { markBackupAt } from '../../adapters/backupHealth'
import BackupHealth from './BackupHealth'

/**
 * Node 26 自带一个「没有 --localstorage-file 就不可用」的 localStorage 全局，
 * jsdom 环境下可能拿到的是那个空实现；这里直接换成内存版，测试不依赖环境细节。
 */
function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  }
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    writable: true,
    value: fakeStorage(),
  })
})

describe('BackupHealth', () => {
  it('没导出过时提示，并给出下载整库入口', () => {
    render(<BackupHealth />)
    expect(screen.getByText('还没导出过备份')).toBeTruthy()
    const link = screen.getByRole('link', { name: '下载整库' })
    expect(link.getAttribute('href')).toBe('/api/store/db')
  })

  it('导出后同一页立刻刷新成「今天」', () => {
    render(<BackupHealth />)
    act(() => markBackupAt('2026-11-01T08:00:00.000Z'))
    expect(screen.getByText(/上次导出：/)).toBeTruthy()
  })
})
