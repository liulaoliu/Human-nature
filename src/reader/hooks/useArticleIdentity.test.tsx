// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useArticleIdentity, type UseArticleIdentityParams } from './useArticleIdentity'

const S1 = [{ text: 'Hello world.' }, { text: 'Second sentence.' }]
const S2 = [{ text: 'A different article.' }]

function setup(initial: Partial<UseArticleIdentityParams> = {}) {
  const params: UseArticleIdentityParams = {
    articleKey: null,
    savedId: null,
    articleTitle: '标题',
    sentences: S1,
    ...initial,
  }
  const hook = renderHook(() => useArticleIdentity(params))
  const set = (patch: Partial<UseArticleIdentityParams>) => {
    Object.assign(params, patch)
    hook.rerender()
  }
  return { p: params, set, ...hook }
}

describe('useArticleIdentity：正文没换，身份不换', () => {
  it('已保存文章：身份就是 savedId', () => {
    const { result } = setup({ savedId: 'saved:7' })
    expect(result.current).toEqual({ identity: 'saved:7', reuseId: null })
  })

  it('删掉保存后同一篇正文：仍用原 id，且给出可复用的 id（不回退标题）', () => {
    const { result, set } = setup({ savedId: 'saved:7', articleTitle: 'Profits overboard' })
    set({ savedId: null, articleTitle: 'Profits overboard（重复·可删）' })
    expect(result.current).toEqual({ identity: 'saved:7', reuseId: 'saved:7' })
  })

  it('换了正文：才允许回退到标题', () => {
    const { result, set } = setup({ savedId: 'saved:7' })
    set({ savedId: null, articleTitle: '另一篇', sentences: S2 })
    expect(result.current).toEqual({ identity: '另一篇', reuseId: null })
  })

  it('从没保存过：用标题；标题也空就用「手动粘贴」', () => {
    expect(setup({ articleTitle: '手动粘的一篇' }).result.current).toEqual({
      identity: '手动粘的一篇',
      reuseId: null,
    })
    expect(setup({ articleTitle: '' }).result.current).toEqual({ identity: '手动粘贴', reuseId: null })
  })

  it('内置文章：articleKey 优先，不参与复用', () => {
    const { result } = setup({ articleKey: '005 Leaders - Post-truth politics', articleTitle: '标题' })
    expect(result.current).toEqual({ identity: '005 Leaders - Post-truth politics', reuseId: null })
  })

  it('用复用 id 重新保存后身份保持同一个键', () => {
    const { result, set } = setup({ savedId: 'saved:7' })
    set({ savedId: null })
    expect(result.current.identity).toBe('saved:7')
    set({ savedId: 'saved:7' })
    expect(result.current).toEqual({ identity: 'saved:7', reuseId: null })
  })

  it('同一篇里改标题不影响身份（正文没变）', () => {
    const { result, set } = setup({ savedId: 'saved:7' })
    set({ articleTitle: '改了标题' })
    expect(result.current.identity).toBe('saved:7')
  })

  it('没有正文时不复用（避免空签名串篇）', () => {
    const { result, set } = setup({ savedId: 'saved:7' })
    set({ savedId: null, sentences: [] })
    expect(result.current).toEqual({ identity: '标题', reuseId: null })
  })
})
