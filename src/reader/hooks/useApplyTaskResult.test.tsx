// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useApplyTaskResult, type UseApplyTaskResultParams } from './useApplyTaskResult'
import type { VocabItem, VocabLibrary } from '../../types/document'
import type { AiTaskKey } from './useAiTasks'
import { createLibrary } from '../../core/vocab'

const now = '2026-10-19T00:00:00.000Z'

function item(word: string, lemma = word): VocabItem {
  return {
    id: `vocab:${lemma}`,
    word,
    lemma,
    phonetic: null,
    partOfSpeech: 'v.',
    meaning: '跑',
    usage: [],
    examples: [],
    source: null,
    status: 'unqueried',
    note: '',
    tags: [],
    reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
    createdAt: now,
    updatedAt: now,
  }
}

function baseLibrary(): VocabLibrary {
  return { ...createLibrary(), items: [item('run')] }
}

function makeParams(lib = baseLibrary()): UseApplyTaskResultParams {
  return {
    library: lib,
    libraryRef: { current: lib },
    sentence: { id: 's1', text: 'He runs.', translation: '', grammarNote: '', collocations: [], vocab: [] },
    persist: vi.fn(),
    mergeBatch: vi.fn(),
    batchItemsFromWords: (words) => words.map((w) => ({ word: w, sentence: 'He runs.', sentenceId: 's1' })),
    autoVocabDirect: false,
    commitBatchItems: vi.fn(),
    articleTitle: 'A',
    articleKey: 'a1',
    articleIdentity: 'a1',
    writingModel: 'model',
    writingText: 'my text',
    writingTask: null,
    recordActivity: vi.fn(),
    ecdictLevel: 'cet6',
    articleText: 'He runs every day.',
    sentenceForWord: () => ({ sentence: 'He runs.', sentenceId: 's1' }),
    setDoc: vi.fn(),
    setPendingSave: vi.fn(),
    setListenQuiz: vi.fn(),
    setWritingTask: vi.fn(),
    setWritingFeedback: vi.fn(),
    setWritingHistory: vi.fn(),
  }
}

function run(task: AiTaskKey, raw: string, params = makeParams()) {
  const { result } = renderHook(() => useApplyTaskResult(params))
  let outcome
  act(() => {
    outcome = result.current(task, raw, ['run'], ['s1'])
  })
  return { outcome: outcome!, params }
}

describe('useApplyTaskResult：任务注册表', () => {
  it('auto_vocab：解析单词并进待选', () => {
    const { outcome, params } = run('auto_vocab', 'running\nwalking')
    expect(outcome.ok).toBe(true)
    expect(params.mergeBatch).toHaveBeenCalled()
    expect(outcome.report[0]).toContain('待选')
  })

  const table: { task: AiTaskKey; raw: string; expect: string }[] = [
    { task: 'confusable', raw: 'run | running:跑步 ; sprint:冲刺', expect: '混淆项' },
    { task: 'example', raw: 'run | I run daily. | 我每天跑。', expect: '例句' },
    { task: 'phrase', raw: 'run | run out — 用完 | run in the family', expect: '词组' },
    { task: 'grammar_mark', raw: 'run | 及物；不及物', expect: '语法标记' },
    { task: 'lemma', raw: 'running | run', expect: '词形' },
    { task: 'pos', raw: 'run | running | v. | 谓语动词 | 主语 | 跑 | 主语执行动作 | v.', expect: '辨析' },
    { task: 'listening', raw: JSON.stringify({ questions: [{ type: 'mcq', stem: 'What?', answer: 'A', options: ['A', 'B'] }] }), expect: '题' },
    { task: 'language', raw: JSON.stringify({ sentences: [{ id: 's1', structure: '主谓' }] }), expect: '语言点' },
    { task: 'imitation', raw: JSON.stringify({ task: '仿写', model: 'He runs.', rubric: [] }), expect: '仿写任务' },
    { task: 'feedback', raw: JSON.stringify({ scores: [{ dimension: '语法', score: 8, max: 10 }], total: 8, max: 10 }), expect: '批改' },
  ]

  it.each(table)('$task：命中注册表并返回回执', ({ task, raw, expect: expected }) => {
    const { outcome } = run(task, raw)
    expect(outcome.ok).toBe(true)
    expect(outcome.report.join(' ')).toContain(expected)
  })

  it('lookup 走通用解析：词条落库并带来源', () => {
    const { outcome, params } = run('lookup', 'run | /rʌn/ | v. | 跑 | run out — 用完 | I run. — 我跑。')
    expect(outcome.ok).toBe(true)
    expect(outcome.report[0]).toContain('词条')
    const next = (params.libraryRef.current as VocabLibrary).items.find((it) => it.lemma === 'run')
    expect(next?.source?.sentenceText).toBe('He runs.')
  })

  it('空输入 / 坏格式：ok=false，保留粘贴内容（不写库）', () => {
    const { outcome, params } = run('confusable', '随便写点')
    expect(outcome.ok).toBe(false)
    expect(params.persist).not.toHaveBeenCalled()
  })
})
