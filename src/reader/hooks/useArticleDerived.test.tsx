// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { sentenceFixture, vocabItem } from '../../core/testFixtures'
import { useArticleDerived, type UseArticleDerivedParams } from './useArticleDerived'

const stableItem = (id: string) =>
  vocabItem({
    id,
    word: id,
    lemma: id,
    meaning: '意思',
    reviewState: { due: null, interval: 10, ease: 2.5, repetitions: 3, lapses: 0 },
  })

function params(over: Partial<UseArticleDerivedParams> = {}): UseArticleDerivedParams {
  return {
    articleIdentity: 'a1',
    articleWordItems: [],
    doc: null,
    practice: [],
    mistakes: [],
    writingHistory: [],
    retells: [],
    kindStats: {},
    activity: [],
    skimmedArticles: [],
    ...over,
  }
}

describe('useArticleDerived：本篇归属', () => {
  it('复述 / 略读只认当前文章', () => {
    const { result } = renderHook(() =>
      useArticleDerived(
        params({
          retells: [
            { at: 't1', articleId: 'a1', text: 'one', words: 1 },
            { at: 't2', articleId: 'a2', text: 'two two', words: 2 },
          ],
          skimmedArticles: ['a2'],
        }),
      ),
    )
    expect(result.current.myRetells.map((r) => r.text)).toEqual(['one'])
    expect(result.current.intensiveSkimmed).toBe(false)
  })

  it('略读标记影响工作流第一阶段', () => {
    const { result } = renderHook(() => useArticleDerived(params({ skimmedArticles: ['a1'] })))
    expect(result.current.intensiveSkimmed).toBe(true)
    const skim = result.current.intensivePlan.stages.find((s) => s.key === 'skim')
    expect(skim?.progress).toBe(100)
  })
})

describe('useArticleDerived：掌握度 / 工作流 / 产出', () => {
  it('掌握度按 stable / due / fresh 统计，并带精读维度', () => {
    const { result } = renderHook(() =>
      useArticleDerived(
        params({
          articleWordItems: [stableItem('run'), vocabItem({ id: 'calm', word: 'calm', lemma: 'calm' })],
          doc: { sentences: [sentenceFixture('s1'), sentenceFixture('s2')] },
        }),
      ),
    )
    const words = result.current.articleMastery.dimensions.find((d) => d.key === 'words')
    expect(words?.detail).toContain('1/2 稳定')
    expect(words?.detail).toContain('未学 1')
    const reading = result.current.articleMastery.dimensions.find((d) => d.key === 'reading')
    expect(reading?.detail).toContain('译文 0/2')
  })

  it('词阶段只数普通单词：语言点条目不进分母（usage 永远不背，会把「学过」卡在 100% 以下）', () => {
    const { result } = renderHook(() =>
      useArticleDerived(
        params({
          // 调用方只把单词传进来；这里钉住「分母就是这一份」的口径
          articleWordItems: [stableItem('run')],
          skimmedArticles: ['a1'],
        }),
      ),
    )
    const vocab = result.current.intensivePlan.stages.find((s) => s.key === 'vocab')
    expect(vocab?.progress).toBe(100)
    expect(vocab?.detail).toContain('1/1')
    const recall = result.current.intensivePlan.stages.find((s) => s.key === 'recall')
    expect(recall?.detail).toContain('学过 1/1')
  })

  it('只填了习语的词也算「有词块」', () => {
    const { result } = renderHook(() =>
      useArticleDerived(
        params({
          articleWordItems: [
            vocabItem({ id: 'run', word: 'run', lemma: 'run', meaning: '跑', idioms: ['run in the family'] }),
          ],
        }),
      ),
    )
    const chunks = result.current.intensivePlan.stages.find((s) => s.key === 'chunks')
    expect(chunks?.progress).toBe(100)
    expect(result.current.outputBoard.rows.find((r) => r.key === 'chunkCover')?.value).toBe('1/1')
  })

  it('AI 明确说「无搭配」的词也算词块阶段做完（不然永远差一截、精通拿不到）', () => {
    const { result } = renderHook(() =>
      useArticleDerived(
        params({
          articleWordItems: [vocabItem({ id: 'mrs', word: 'mrs', lemma: 'mrs', meaning: '夫人', phrases: [], idioms: [] })],
        }),
      ),
    )
    const chunks = result.current.intensivePlan.stages.find((s) => s.key === 'chunks')
    expect(chunks?.progress).toBe(100)
    expect(chunks?.status).toBe('done')
    expect(chunks?.detail).toContain('已问过 1')
    // 覆盖率（产出看板）仍如实反映「真有搭配的只有 0 个」
    expect(result.current.outputBoard.rows.find((r) => r.key === 'chunkCover')?.value).toBe('0/1')
  })

  it('工作流的产出阶段看本篇仿写条数', () => {
    const { result } = renderHook(() =>
      useArticleDerived(
        params({
          writingHistory: [
            {
              at: 't1',
              articleId: 'a1',
              model: 'm',
              text: 'my try',
              feedback: { scores: [], total: 8, max: 10, issues: [] },
            },
          ],
        }),
      ),
    )
    const produce = result.current.intensivePlan.stages.find((s) => s.key === 'produce')
    expect(produce?.progress).toBe(100)
  })

  it('产出看板按词块正确率 / 仿写 / 复述汇总', () => {
    const { result } = renderHook(() =>
      useArticleDerived(
        params({
          articleWordItems: [vocabItem({ id: 'run', word: 'run', lemma: 'run', usage: ['run out'] })],
          kindStats: { a1: { usage: { total: 4, correct: 3 } } },
          writingHistory: [
            {
              at: 't1',
              articleId: 'a1',
              model: 'm',
              text: 'my try',
              feedback: { scores: [], total: 9, max: 10, issues: [] },
            },
          ],
          retells: [{ at: 't1', articleId: 'a1', text: 'my retell', words: 20 }],
        }),
      ),
    )
    const rows = result.current.outputBoard.rows
    expect(rows.find((r) => r.key === 'chunkAcc')?.value).toBe('75%（3/4）')
    expect(rows.find((r) => r.key === 'write')?.value).toContain('1 条')
    expect(rows.find((r) => r.key === 'retell')?.value).toBe('1 条 · 20 词')
  })
})
