import { describe, it, expect } from 'vitest'
import {
  buildAutoVocabPrompt,
  buildBatchLookupPrompt,
  buildCleanupPrompt,
  buildConfusablePrompt,
  buildPrompt,
} from './analyzerPrompt'
import { FENCE, HEADER, type AnalysisTask } from './analyzerShared'

const TEXT = 'The quick brown fox jumps over the lazy dog.'

describe('analyzerPrompt 提示词构建', () => {
  it('每个任务都带上统一口吻且非空', () => {
    const tasks: AnalysisTask[] = ['translate', 'lookup', 'grammar', 'collocations', 'summarize', 'extract_vocab', 'auto_vocab']
    for (const task of tasks) {
      const p = buildPrompt({ task, text: TEXT })
      expect(p, task).toContain(HEADER)
      expect(p.length, task).toBeGreaterThan(HEADER.length + 20)
    }
  })

  it('lookup 优先用 words，没给才退回 text', () => {
    expect(buildPrompt({ task: 'lookup', text: TEXT, words: ['fox', 'dog'] })).toContain('单词：fox, dog')
    expect(buildPrompt({ task: 'lookup', text: 'fox' })).toContain('单词：fox')
  })

  it('原文一律用三引号围栏包住，不会被当成指令', () => {
    expect(buildPrompt({ task: 'translate', text: ` ${TEXT} ` })).toContain(`${FENCE}\n${TEXT}\n${FENCE}`)
  })

  it('auto_vocab 按词汇水平切换基准描述', () => {
    const cet4 = buildAutoVocabPrompt(TEXT, 'cet4')
    const ielts65 = buildAutoVocabPrompt(TEXT, 'ielts65')
    expect(cet4).toContain('四级')
    expect(ielts65).toContain('雅思 6.5')
    expect(buildAutoVocabPrompt(TEXT)).toContain('六级') // 默认 cet6
  })

  it('batchLookup 按小写去重，且带上每条上下文', () => {
    const p = buildBatchLookupPrompt([{ word: 'Run', context: TEXT }, { word: 'run' }, { word: 'dog' }])
    expect(p.match(/^- run/gim)).toHaveLength(1)
    expect(p).toContain(`- Run  （上下文：${TEXT}）`)
    expect(p).toContain('- dog')
  })

  it('cleanup 明确要求原样保留【…】标记', () => {
    expect(buildCleanupPrompt('【标题】\nBody text.')).toContain('【……】')
  })

  it('confusable 明确排除义近词（否则选择题会有多个正确答案）', () => {
    const p = buildConfusablePrompt([{ word: 'adapt', meaning: '适应' }])
    expect(p).toContain('绝不能')
    expect(p).toContain('近义词')
    expect(p).toContain('- adapt（适应）')
  })
})
