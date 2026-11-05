import { describe, expect, it } from 'vitest'
import { defaultReviewState } from '../types/document'
import { sentenceFixture, vocabItem } from './testFixtures'
import {
  buildProductionPackPrompt,
  buildProductionTargets,
  checkProductionTargets,
  DEFAULT_PRODUCTION_SETTINGS,
  makeProductionTask,
  normalizeProductionSettings,
  parseProductionPack,
  productionDocLemmas,
  targetUsed,
  type ProductionTarget,
} from './production'

const target = (over: Partial<ProductionTarget> = {}): ProductionTarget => ({
  id: 'v1|self|word',
  itemId: 'v1',
  kind: 'word',
  text: 'run',
  meaning: '跑',
  ...over,
})

describe('buildProductionTargets：选词块', () => {
  const weak = vocabItem({
    id: 'v1',
    word: 'run',
    meaning: '跑',
    reviewState: { ...defaultReviewState(), lapses: 2, repetitions: 5 },
    source: { articleId: 'A', fileName: 'A', sentenceId: null, sentenceText: '' },
    phrases: ['run out — 用完'],
    idioms: ['run in the family — 家族遗传'],
  })
  const strong = vocabItem({
    id: 'v2',
    word: 'curb',
    meaning: '抑制',
    reviewState: { ...defaultReviewState(), repetitions: 6 },
    source: { articleId: 'A', fileName: 'A', sentenceId: null, sentenceText: '' },
  })
  const other = vocabItem({
    id: 'v3',
    word: 'anchor',
    lemma: 'anchor',
    meaning: '锚',
    source: { articleId: 'B', fileName: 'B', sentenceId: null, sentenceText: '' },
  })

  it('按范围 + 类型取；词条本身 + phrases/idioms 都算目标块', () => {
    const pool = buildProductionTargets({
      items: [weak, strong, other],
      scope: 'all',
      articleIdentity: 'A',
      docLemmas: new Set(),
      types: ['word', 'phrase', 'idiom'],
      limit: 10,
      weakRatio: 0,
      rng: () => 0,
    })
    expect(pool.targets.map((t) => t.text)).toEqual(
      expect.arrayContaining(['run', 'run out', 'run in the family', 'curb', 'anchor']),
    )
    expect(pool.targets.find((t) => t.text === 'run out')?.meaning).toBe('用完')
  })

  it('本篇范围只取 source/正文 lemmas 命中的', () => {
    const pool = buildProductionTargets({
      items: [weak, strong, other],
      scope: 'article',
      articleIdentity: 'A',
      docLemmas: new Set(['anchor']),
      types: ['word'],
      limit: 10,
      weakRatio: 0,
      rng: () => 0,
    })
    expect(pool.targets.map((t) => t.itemId).sort()).toEqual(['v1', 'v2', 'v3'])
    const onlyA = buildProductionTargets({
      items: [weak, strong, other],
      scope: 'article',
      articleIdentity: 'A',
      docLemmas: new Set(),
      types: ['word'],
      limit: 10,
      weakRatio: 0,
      rng: () => 0,
    })
    expect(onlyA.targets.map((t) => t.text).sort()).toEqual(['curb', 'run'])
  })

  it('薄弱比例：优先取有 lapses / 复习次数少的词，不够再用正常词补', () => {
    const pool = buildProductionTargets({
      items: [weak, strong],
      scope: 'all',
      articleIdentity: 'A',
      docLemmas: new Set(),
      types: ['word'],
      limit: 2,
      weakRatio: 100,
      rng: () => 0,
    })
    expect(pool.targets.some((t) => t.text === 'run')).toBe(true)
    expect(pool.targets).toHaveLength(2)
    expect(pool.weak).toBe(1)
  })

  it('类型为空 / 词池为空：返回空，不炸', () => {
    expect(
      buildProductionTargets({
        items: [weak],
        scope: 'all',
        articleIdentity: 'A',
        docLemmas: new Set(),
        types: [],
        limit: 5,
        weakRatio: 30,
      }).targets,
    ).toEqual([])
  })
})

describe('parseProductionPack：只认候选清单里的目标块', () => {
  const allowed = [target(), target({ id: 'p1|phrase|0', kind: 'phrase', text: 'run out', meaning: '用完' })]

  it('解析合法 JSON；坏 id / 空中文 / 重复目标都过滤', () => {
    const prompts = parseProductionPack(
      JSON.stringify({
        prompts: [
          { zh: '跟同事说项目会晚点。', goal: '说明进度', targetIds: ['v1|self|word', 'p1|phrase|0'] },
          { zh: '', goal: 'x', targetIds: ['v1|self|word'] },
          { zh: '第二个情境', goal: '拒绝', targetIds: ['bad', 'v1|self|word', 'v1|self|word'] },
        ],
      }),
      allowed,
    )
    expect(prompts).toHaveLength(2)
    expect(prompts?.[0].targets.map((t) => t.text)).toEqual(['run', 'run out'])
    expect(prompts?.[1].targets.map((t) => t.text)).toEqual(['run'])
  })

  it('坏 JSON / 没有 prompts：返回 null', () => {
    expect(parseProductionPack('not json', allowed)).toBeNull()
    expect(parseProductionPack('{"prompts":[]}', allowed)).toBeNull()
  })

  it('出题提示词包含候选清单，要求中文不出现英文目标词', () => {
    const prompt = buildProductionPackPrompt({
      topic: '远程办公',
      angle: 'work',
      tone: 'formal',
      articleTitle: 'A',
      targets: allowed,
      promptCount: 2,
      targetsPerPrompt: 1,
    })
    expect(prompt).toContain('远程办公')
    expect(prompt).toContain('v1|self|word')
    expect(prompt).toContain('run')
    expect(prompt).toContain('不能出现英文目标词')
  })
})

describe('targetUsed / checkProductionTargets：目标块硬校验', () => {
  it('单词允许常见词形后缀，词组按连续文本匹配', () => {
    expect(targetUsed('I am running daily.', target())).toBe(true)
    expect(targetUsed('I ran daily.', target())).toBe(false)
    expect(targetUsed('We need to run out of time.', target({ kind: 'phrase', text: 'run out' }))).toBe(true)
    expect(targetUsed('run-out', target({ kind: 'phrase', text: 'run out' }))).toBe(false)
  })

  it('逐项命中；全中 exact', () => {
    const hits = checkProductionTargets('I run out every morning.', [
      target(),
      target({ id: 'p1', kind: 'phrase', text: 'run out' }),
    ])
    expect(hits.map((h) => h.used)).toEqual([true, true])
    expect(checkProductionTargets('nothing', [target()])[0].used).toBe(false)
  })
})

describe('ProductionSettings / task / doc lemmas', () => {
  it('坏设置逐项回默认', () => {
    expect(normalizeProductionSettings(null)).toEqual(DEFAULT_PRODUCTION_SETTINGS)
    expect(
      normalizeProductionSettings({
        topic: '  x  ',
        angle: 'bad',
        tone: 'bad',
        scope: 'bad',
        types: ['word', 'bad', 'word'],
        promptCount: 4,
        targetsPerPrompt: 9,
        weakRatio: 31,
      }),
    ).toEqual({ ...DEFAULT_PRODUCTION_SETTINGS, topic: 'x', types: ['word'] })
  })

  it('任务复用仿写 rubric，mustUse = 目标块', () => {
    const task = makeProductionTask(
      { id: 'p1', zh: '说明进度', goal: '汇报', targets: [target()] },
      '工作',
    )
    expect(task.mustUse).toEqual(['run'])
    expect(task.task).toBe('说明进度')
    expect(task.rubric).toHaveLength(3)
  })

  it('正文词 + 语言点词都算本篇 lemma', () => {
    const s = sentenceFixture('s1', 'A run.', {
      vocab: ['run'],
      languages: [{ phrases: ['run out'], idioms: ['run in the family'] }],
    })
    expect([...productionDocLemmas([s])].sort()).toEqual(['run', 'run in the family', 'run out'])
  })
})
