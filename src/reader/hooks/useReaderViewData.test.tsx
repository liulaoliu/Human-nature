// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { sentenceFixture, vocabItem } from '../../core/testFixtures'
import { useReaderViewData, type UseReaderViewDataParams } from './useReaderViewData'

function params(over: Partial<UseReaderViewDataParams> = {}): UseReaderViewDataParams {
  return {
    doc: null,
    libraryItems: [],
    batchCount: 0,
    confusableTodoCount: 0,
    lemmaCandidatesCount: 0,
    writingHistoryCount: 0,
    listenQuiz: null,
    quizArticleKinds: ['grammar', 'phraseBlank', 'translate2', 'functionWord', 'ordering'],
    studiedDays: [],
    saved: [],
    activity: [],
    practice: [],
    journalDay: '2026-10-19',
    ...over,
  }
}

describe('useReaderViewData：就绪清单', () => {
  it('没文章时「文章」阻塞；有文章 + 生词时就绪', () => {
    const empty = renderHook(() => useReaderViewData(params()))
    expect(empty.result.current.readyRows.find((r) => r.key === 'article')?.level).toBe('blocked')

    const doc = { sentences: [sentenceFixture('s1', 'One.', { translation: '一' }), sentenceFixture('s2')] }
    const { result } = renderHook(() =>
      useReaderViewData(params({ doc, libraryItems: [vocabItem({ id: 'v1', word: 'run', lemma: 'run' })] })),
    )
    const article = result.current.readyRows.find((r) => r.key === 'article')
    expect(article?.level).toBe('ready')
    expect(article?.detail).toBe('2 句')
    expect(result.current.readyRows.find((r) => r.key === 'sentence')?.detail).toContain('已译 1 / 2 句')
    expect(result.current.readyRows.find((r) => r.key === 'vocab')?.detail).toBe('1 个词')
  })

  it('待选 / 缺释义 / 到期分别反映到对应行', () => {
    const { result } = renderHook(() =>
      useReaderViewData(
        params({
          batchCount: 2,
          libraryItems: [
            vocabItem({ id: 'a', word: 'a', lemma: 'a', meaning: null }),
            vocabItem({
              id: 'b',
              word: 'b',
              lemma: 'b',
              meaning: '意思',
              reviewState: { ease: 2.5, due: '2020-01-01T00:00:00.000Z', interval: 1, repetitions: 1 },
            }),
          ],
        }),
      ),
    )
    expect(result.current.readyRows.find((r) => r.key === 'batch')?.detail).toBe('2 个待处理')
    const vocabRow = result.current.readyRows.find((r) => r.key === 'vocab')
    expect(vocabRow?.level).toBe('ready')
  })
})

describe('useReaderViewData：学习日志 / 打印索引 / 测验数', () => {
  it('日志按活动日期出天，选中日的数据可查', () => {
    const { result } = renderHook(() =>
      useReaderViewData(
        params({
          activity: [{ day: '2026-10-19', counts: { read: 2, vocab: 1 } }],
          practice: [{ at: '2026-10-19T08:00:00.000Z', kind: 'quiz', total: 5, correct: 4 }],
        }),
      ),
    )
    expect(result.current.journalAllDays).toContain('2026-10-19')
    expect(result.current.journalData.day).toBe('2026-10-19')
    expect(result.current.journalSummaryRows.some((r) => r.day === '2026-10-19')).toBe(true)
    expect(result.current.journalHeat.cells.length).toBe(13)
  })

  it('打印索引按篇抽正文 lemma', () => {
    const { result } = renderHook(() =>
      useReaderViewData(
        params({
          saved: [{ id: 'a1', title: 'A', sentences: [sentenceFixture('s1', 'Run fast, run far.')] }],
        }),
      ),
    )
    const row = result.current.exportArticles[0]
    expect(row.id).toBe('a1')
    expect(row.lemmas.has('run')).toBe(true)
    expect(row.lemmas.has('fast')).toBe(true)
  })

  it('文章测验可出题数：空文章 0，有句子大于 0', () => {
    const empty = renderHook(() => useReaderViewData(params()))
    expect(empty.result.current.articleQuizCount).toBe(0)

    const doc = {
      sentences: [
        sentenceFixture('s1', 'The quick brown fox jumps over the lazy dog.'),
        sentenceFixture('s2', 'She has been working here for years.'),
      ],
    }
    const { result } = renderHook(() => useReaderViewData(params({ doc })))
    expect(result.current.articleQuizCount).toBeGreaterThan(0)
  })
})
