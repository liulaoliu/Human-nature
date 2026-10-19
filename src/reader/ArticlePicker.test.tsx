// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ArticlePicker from './ArticlePicker'
import type { SavedArticle } from '../core/ports'

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

  it('搜索后点结果仍然能选中并关闭', () => {
    const { onPick } = setup()
    fireEvent.change(screen.getByPlaceholderText('搜索文章标题…'), { target: { value: 'alpha saved' } })
    fireEvent.click(screen.getByText('Alpha saved'))

    expect(onPick).toHaveBeenCalledWith('s:s1')
    expect(screen.queryByPlaceholderText('搜索文章标题…')).toBeNull()
  })
})
