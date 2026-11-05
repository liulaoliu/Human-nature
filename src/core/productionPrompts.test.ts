import { describe, expect, it } from 'vitest'
import type { ProductionTarget } from './production'
import {
  buildProductionFeedbackPrompt,
  buildProductionPackPrompt,
  buildTopicPackPrompt,
  makeProductionTask,
  parseProductionPack,
  validateProductionPack,
} from './productionPrompts'

const target: ProductionTarget = {
  id: 'v1|self|word',
  itemId: 'v1',
  kind: 'word',
  text: 'run',
  meaning: '跑',
}

describe('productionPrompts：出题 / 解析 / 批改契约', () => {
  it('题目包只从候选 id 里选，硬校验数量与重复', () => {
    const allowed = [target, { ...target, id: 'p1', kind: 'phrase' as const, text: 'run out' }]
    const parsed = parseProductionPack(
      JSON.stringify({
        prompts: [{ zh: '说明进度', goal: '汇报', targetIds: ['v1|self|word', 'bad'] }],
      }),
      allowed,
      2,
    )
    expect(parsed?.[0].targets).toHaveLength(1)
    expect(validateProductionPack(parsed ?? [], 1, 1).ok).toBe(true)
    expect(validateProductionPack(parsed ?? [], 2, 1).ok).toBe(false)
  })

  it('主题包支持随机主题 + 难度', () => {
    const prompt = buildTopicPackPrompt({
      topic: '',
      angle: 'daily',
      tone: 'neutral',
      level: 'b1',
      articleTitle: '',
      promptCount: 2,
      randomTopic: true,
    })
    expect(prompt).toContain('主题：随机自选')
    expect(prompt).toContain('B1 基础')
  })

  it('英译中任务用中文 rubric，并给批改提示词加语言说明', () => {
    const task = makeProductionTask(
      { id: 'p1', zh: 'Hello.', goal: '英译中', targets: [], reference: '你好。', answerLang: 'zh' },
      '风味酸奶',
      'yogurt',
      's1',
    )
    expect(task.answerLang).toBe('zh')
    expect(task.sessionId).toBe('s1')
    expect(task.rubric[0].dimension).toBe('英文原意')
    expect(buildProductionFeedbackPrompt(task, '你好')).toContain('英译中')
  })

  it('出题提示词带候选目标块；全脂提示随机主题', () => {
    const pack = buildProductionPackPrompt({
      mode: 'full',
      topic: '',
      angle: 'daily',
      tone: 'neutral',
      level: 'b2',
      articleTitle: 'A',
      targets: [target],
      promptCount: 1,
      targetsPerPrompt: 1,
    })
    expect(pack).toContain('随机自选')
    expect(pack).toContain('v1|self|word')
    expect(pack).not.toContain('参考文章')
  })
})
