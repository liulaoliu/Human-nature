// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useApplyTaskResult, type UseApplyTaskResultParams } from './useApplyTaskResult'
import { createLibrary } from '../../core/vocab'
import type { VocabLibrary } from '../../types/document'
import { parseEcdict } from '../../core/ecdict'
import { setDictionary } from '../../adapters/dictionary'

/**
 * 「词性、释义、英英必须同源」在**回填这条路上**的回归。
 *
 * 真实病例（2026-10-22）：巴西那句 "…a black middle class to rival America's"，
 * AI 给的释义是动词义「与……匹敌」，但**词性那一列是空的**；旧代码拿词典词头首义
 * 顶上 n.，卡片就成了「n. 与……匹敌」——释义对、词性错，看着像词性错了，其实是
 * 两个义项被拼在一张卡上。
 */
const DICT = parseEcdict(
  [
    'word\tphonetic\tpos\ten\tzh\ttag\tcollins\toxford\tbnc\tfrq',
    'rival\t\'raivl\t\tn. the contestant you hope to defeat\\nv. be the rival of, be in competition with\tn. 对手, 竞争者\\na. 竞争的\tcet4\t4\t1\t3058\t4346',
  ].join('\n'),
  '',
  '',
)

afterEach(() => setDictionary(null))

function params(): UseApplyTaskResultParams {
  const lib: VocabLibrary = createLibrary()
  return {
    library: lib,
    libraryRef: { current: lib },
    sentence: {
      id: 's1',
      paraId: 'p1',
      text: "Brazil has a long way to go before it has a black middle class to rival America's.",
      audio: null,
      translation: null,
      grammarNote: null,
      collocations: [],
      vocab: [],
      tags: [],
      reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
    },
    persist: vi.fn(),
    mergeBatch: vi.fn(),
    batchItemsFromWords: (words) => words.map((w) => ({ word: w, sentence: 's', sentenceId: 's1' })),
    autoVocabDirect: false,
    commitBatchItems: vi.fn(),
    articleTitle: 'A',
    articleKey: 'a1',
    articleIdentity: 'a1',
    listeningKey: 'a1@sig',
    writingModel: 'model',
    writingText: 'my text',
    writingTask: null,
    recordActivity: vi.fn(),
    ecdictLevel: 'cet6',
    articleText: 'x',
    sentenceForWord: () => ({ sentence: 'x', sentenceId: 's1' }),
    setDoc: vi.fn(),
    setPendingSave: vi.fn(),
    setListenQuiz: vi.fn(),
    setWritingTask: vi.fn(),
    setWritingFeedback: vi.fn(),
    setWritingHistory: vi.fn(),
  }
}

function runLookup(raw: string, p = params()) {
  const { result } = renderHook(() => useApplyTaskResult(p))
  act(() => {
    result.current('lookup', raw, ['rival'], ['s1'])
  })
  return (p.libraryRef.current as VocabLibrary).items.find((it) => it.lemma === 'rival')
}

describe('回填查词结果：词性不许用词典词头首义顶替', () => {
  it('AI 给了释义、没给词性 → 词性留空（不是 n.）', () => {
    setDictionary(DICT)
    const it = runLookup('rival | /ˈraɪvl/ | | 与……匹敌 | rival sb in sth — 在某方面与某人匹敌 | He rivals me. — 他与我匹敌。')
    expect(it?.meaning).toBe('与……匹敌')
    expect(it?.partOfSpeech ?? null).toBeNull()
    expect(it?.fieldSources?.partOfSpeech).toBeUndefined()
  })

  it('AI 给了词性 → 用 AI 的（v.），跟释义同一行答案', () => {
    setDictionary(DICT)
    const it = runLookup('rival | /ˈraɪvl/ | v. | 与……匹敌 | rival sb in sth — 在某方面与某人匹敌 | He rivals me. — 他与我匹敌。')
    expect(it?.partOfSpeech).toBe('v.')
    expect(it?.fieldSources?.partOfSpeech).toBe('ai')
  })

  it('AI 没给释义，改用词典释义时词性取同一行的标记（n. 对手）', () => {
    setDictionary(DICT)
    const it = runLookup('rival | /ˈraɪvl/ | | | |')
    expect(it?.meaning).toBe('n. 对手, 竞争者')
    expect(it?.partOfSpeech).toBe('n.')
  })
})
