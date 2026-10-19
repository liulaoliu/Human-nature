import { describe, expect, it } from 'vitest'
import { buildMissingPrompt, type MissingTask } from './missingPrompts'

const items = [
  {
    lemma: 'run',
    word: 'running',
    meaning: '跑',
    source: { articleId: 'a1', fileName: 'a1', sentenceId: 's1', sentenceText: 'He is running.' },
  },
]

const tasks: MissingTask[] = ['confusable', 'lookup', 'lemma', 'pos', 'phrase', 'grammar_mark']

describe('buildMissingPrompt（漏词重试提示词）', () => {
  it.each(tasks)('%s：包含词库里的显示形式和语境/释义', (task) => {
    const prompt = buildMissingPrompt(task, ['running'], items)
    expect(prompt).toContain('running')
    if (task === 'lemma' || task === 'pos' || task === 'lookup') {
      expect(prompt).toContain('He is running.')
    } else {
      expect(prompt).toContain('跑')
    }
  })

  it('词库里找不到时保留原始拼写，不丢词', () => {
    const prompt = buildMissingPrompt('phrase', ['unknown phrase'], [])
    expect(prompt).toContain('unknown phrase')
  })
})
