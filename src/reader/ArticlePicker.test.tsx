// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ArticlePicker from './ArticlePicker'
import type { SavedArticle } from '../core/ports'
import { clearRecentArticlesMemory } from '../state/recentArticles'
import { installFakeStorage } from './testStorage'

let restoreStorage: () => void = () => {}
beforeEach(() => {
  restoreStorage = installFakeStorage()
  clearRecentArticlesMemory()
})
afterEach(() => restoreStorage())

function saved(id: string, title: string): SavedArticle {
  return {
    id,
    title,
    sourceKey: null,
    text: '',
    paragraphs: [],
    sentences: [],
    updatedAt: '2026-10-19T00:00:00.000Z',
  }
}

function setup(savedList: SavedArticle[] = [saved('s1', 'Alpha saved'), saved('s2', 'Beta saved')]) {
  const onPick = vi.fn()
  render(
    <ArticlePicker
      book={{}}
      saved={savedList}
      savedGroups={[['单篇', savedList]]}
      builtinKeys={['Alpha builtin', 'Beta builtin']}
      currentValue=""
      onPick={onPick}
    />,
  )
  fireEvent.click(screen.getByTitle('选择文章'))
  return { onPick }
}

describe('ArticlePicker：最近打开', () => {
  it('置顶单独分组；点它就打开，同一条不会重复', () => {
    localStorage.setItem('reader:recentArticles', JSON.stringify(['s:s2', 's:s1']))
    const { onPick } = setup()

    expect(screen.getByText('最近打开（2）')).toBeTruthy()
    // 最近分组在最上面，目录里仍各有一份（Beta saved 出现两次）
    expect(screen.getAllByText('Beta saved')).toHaveLength(2)
    fireEvent.click(screen.getAllByText('Beta saved')[0]!)
    expect(onPick).toHaveBeenCalledWith('s:s2')
  })

  it('搜索 / 只看未读同样过滤最近分组；一篇都不匹配就不显示分组', () => {
    localStorage.setItem('reader:recentArticles', JSON.stringify(['s:s2']))
    setup()
    fireEvent.change(screen.getByPlaceholderText('搜索文章标题…'), { target: { value: 'alpha' } })
    expect(screen.queryByText('最近打开（1）')).toBeNull()
  })

  it('没有最近记录时不渲染空分组', () => {
    setup()
    expect(screen.queryByText(/最近打开/)).toBeNull()
  })

  it('当前文章一变就记进最近打开', () => {
    const list = [saved('s1', 'Alpha saved'), saved('s2', 'Beta saved')]
    render(
      <ArticlePicker
        book={{}}
        saved={list}
        savedGroups={[['单篇', list]]}
        builtinKeys={[]}
        currentValue="s:s2"
        onPick={vi.fn()}
      />,
    )
    expect(JSON.parse(localStorage.getItem('reader:recentArticles') ?? 'null')).toEqual(['s:s2'])
  })
})

describe('ArticlePicker：标题搜索', () => {
  it('按标题过滤内置与已保存列表（不区分大小写）', () => {
    setup()
    fireEvent.change(screen.getByPlaceholderText('搜索文章标题…'), { target: { value: 'ALPHA' } })

    expect(screen.getByText('Alpha builtin')).toBeTruthy()
    expect(screen.getByText('Alpha saved')).toBeTruthy()
    expect(screen.queryByText('Beta builtin')).toBeNull()
    expect(screen.queryByText('Beta saved')).toBeNull()
  })

  it('无匹配时给出空状态，不是「都读完了」', () => {
    setup()
    fireEvent.change(screen.getByPlaceholderText('搜索文章标题…'), { target: { value: 'zzz' } })

    expect(screen.getByText('没搜到匹配的文章')).toBeTruthy()
    expect(screen.queryByText('都读完了 🎉')).toBeNull()
  })

  it('搜索词不持久化：关掉再打开就清空', () => {
    setup()
    const input = screen.getByPlaceholderText('搜索文章标题…')
    fireEvent.change(input, { target: { value: 'alpha' } })
    expect((input as HTMLInputElement).value).toBe('alpha')

    // 点选择按钮关闭，再打开
    fireEvent.click(screen.getByTitle('选择文章'))
    fireEvent.click(screen.getByTitle('选择文章'))
    expect((screen.getByPlaceholderText('搜索文章标题…') as HTMLInputElement).value).toBe('')
  })

  it('已保存文章显示导入来源；旧文章没有来源就不标', () => {
    setup([
      saved('s1', 'Alpha saved'),
      { ...saved('s2', 'Beta saved'), origin: 'epub' },
    ])
    expect(screen.getByText('EPUB')).toBeTruthy()
    expect(screen.queryByText('原文库')).toBeNull()
  })

  it('搜索后点结果仍然能选中并关闭', () => {
    const { onPick } = setup()
    fireEvent.change(screen.getByPlaceholderText('搜索文章标题…'), { target: { value: 'alpha saved' } })
    fireEvent.click(screen.getByText('Alpha saved'))

    expect(onPick).toHaveBeenCalledWith('s:s1')
    expect(screen.queryByPlaceholderText('搜索文章标题…')).toBeNull()
  })

  it('显示建立日期；真的改过才附带修改日期', () => {
    setup([
      {
        ...saved('s1', 'Alpha saved'),
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-24T00:00:00.000Z',
      },
      {
        ...saved('s2', 'Beta saved'),
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
    ])

    expect(screen.getByText('2026-10-01 · 改 2026-10-24')).toBeTruthy()
    expect(screen.getByText('2026-10-01')).toBeTruthy()
  })
})
