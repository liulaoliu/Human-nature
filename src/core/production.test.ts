import { describe, expect, it } from 'vitest'
import { defaultReviewState } from '../types/document'
import { sentenceFixture, vocabItem } from './testFixtures'
import {
  buildProductionTargets,
  checkProductionTargets,
  clozeParts,
  clozeSentence,
  shuffledWords,
  DEFAULT_PRODUCTION_SETTINGS,
  normalizeProductionSettings,
  productionDocLemmas,
  targetUsed,
  type ProductionTarget,
} from './production'
import {
  buildProductionPackPrompt,
  buildTopicPackPrompt,
  buildYogurtPrompts,
  buildYogurtPromptsFromPairs,
  makeProductionTask,
  parseProductionPack,
  parseTopicPack,
  validateProductionPack,
  validateTopicPack,
} from './productionPrompts'

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
      mode: 'skim',
      topic: '远程办公',
      angle: 'work',
      tone: 'formal',
      level: 'b2',
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

  it('全脂模式不用主题，提示 AI 随机换场景', () => {
    const prompt = buildProductionPackPrompt({
      mode: 'full',
      topic: '',
      angle: 'daily',
      tone: 'neutral',
      level: 'b2',
      articleTitle: 'A',
      targets: allowed,
      promptCount: 2,
      targetsPerPrompt: 1,
    })
    expect(prompt).toContain('全脂')
    expect(prompt).toContain('不要围绕一个主题')
    expect(prompt).not.toContain('参考文章')
  })

  it('脱脂奶只围绕主题出句，不要求 targetIds', () => {
    const prompt = buildTopicPackPrompt({
      topic: '迟到解释',
      angle: 'work',
      tone: 'neutral',
      level: 'b2',
      articleTitle: 'A',
      promptCount: 3,
    })
    expect(prompt).toContain('迟到解释')
    expect(prompt).toContain('每题只给一个中文句子')
    expect(prompt).not.toContain('targetIds')
    const random = buildTopicPackPrompt({
      topic: '',
      angle: 'daily',
      tone: 'neutral',
      level: 'b2',
      articleTitle: 'A',
      promptCount: 3,
      randomTopic: true,
    })
    expect(random).toContain('主题：随机自选')
    expect(random).not.toContain('参考文章')
    const parsed = parseTopicPack(
      '{"prompts":[{"zh":"解释你为什么迟到了。","goal":"解释原因"}]}',
      3,
    )
    expect(parsed).toHaveLength(1)
    expect(parsed?.[0]).toMatchObject({
      zh: '解释你为什么迟到了。',
      targets: [],
    })
  })
})

describe('风味酸奶：中英对照拆句', () => {
  it('中英句数一致：一句一题，参考译文挂在 prompt 上', () => {
    const result = buildYogurtPrompts(
      '第一句。第二句！\n第三句？',
      'First sentence. Second sentence!\nThird sentence?',
    )
    expect(result?.warning).toBe('')
    expect(result?.prompts).toHaveLength(3)
    expect(result?.prompts[1]).toMatchObject({
      id: 'yogurt-2',
      zh: '第二句！',
      reference: 'Second sentence!',
      targets: [],
    })
  })

  it('句数不一致：按顺序配，末尾并入最后一题并提示', () => {
    const result = buildYogurtPrompts('一。二。三。', 'One. Two.')
    expect(result?.prompts).toHaveLength(2)
    expect(result?.prompts[1].zh).toBe('二。 三。')
    expect(result?.warning).toContain('句数不一致')
  })

  it('缺一边就返回 null', () => {
    expect(buildYogurtPrompts('', 'Hello.')).toBeNull()
    expect(buildYogurtPrompts('你好。', '')).toBeNull()
  })

  it('英译中方向 + 整段连写', () => {
    const result = buildYogurtPromptsFromPairs(
      [
        { source: 'Hello.', reference: '你好。' },
        { source: 'Goodbye.', reference: '再见。' },
      ],
      'en-zh',
      '',
      true,
    )
    expect(result?.prompts).toHaveLength(3)
    expect(result?.prompts[0]).toMatchObject({ answerLang: 'zh', reference: '你好。' })
    expect(result?.prompts[2].goal).toBe('整段英译中')
    expect(result?.prompts[2].zh).toContain('Hello.')
  })
})

describe('targetUsed / checkProductionTargets：目标块硬校验', () => {
  it('单词允许常见词形后缀，词组按连续文本匹配', () => {
    expect(targetUsed('I am running daily.', target())).toBe(true)
    expect(targetUsed('I ran daily.', target())).toBe(true)
    expect(targetUsed('We need to run out of time.', target({ kind: 'phrase', text: 'run out' }))).toBe(true)
    expect(targetUsed('We run quickly out of time.', target({ kind: 'phrase', text: 'run out' }))).toBe(true)
    expect(targetUsed('run-out', target({ kind: 'phrase', text: 'run out' }))).toBe(false)
  })

  it('挖空 / 词序提示只改展示，不破坏原句', () => {
    const model = 'I will follow up with the client.'
    const out = clozeSentence(model, [target({ kind: 'phrase', text: 'follow up' })])
    expect(out).toContain('_____')
    expect(out).not.toContain('follow up')
    expect(model).toBe('I will follow up with the client.')
    const parts = clozeParts(model, [target({ kind: 'phrase', text: 'follow up' })])
    expect(parts.filter((p) => p.target)).toHaveLength(1)
    expect(parts.map((p) => (p.target ? 'BLANK' : p.text)).join('')).toContain('BLANK')
    expect(shuffledWords(model, 'p1').sort()).toEqual(model.split(' ').sort())
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
    expect(
      normalizeProductionSettings({ mode: 'yogurt', sourceText: '中文', referenceText: 'English' }),
    ).toMatchObject({ mode: 'yogurt', sourceText: '中文', referenceText: 'English' })
    expect(
      normalizeProductionSettings({ fullUseChunks: false, skimUseChunks: true }),
    ).toMatchObject({ fullUseChunks: false, skimUseChunks: true })
  })

  it('任务复用仿写 rubric，mustUse = 目标块', () => {
    const task = makeProductionTask(
      { id: 'p1', zh: '说明进度', goal: '汇报', targets: [target()] },
      '工作',
      'skim',
    )
    expect(task.mustUse).toEqual(['run'])
    expect(task.task).toBe('说明进度')
    expect(task.mode).toBe('skim')
    expect(task.rubric).toHaveLength(3)
  })

  it('脱脂奶没有目标块时，rubric 不出现目标词块项', () => {
    const task = makeProductionTask(
      { id: 'topic-1', zh: '解释原因。', goal: '解释', targets: [] },
      '迟到',
      'skim',
    )
    expect(task.rubric.map((r) => r.dimension)).toEqual(['意思到位', '语法与自然度', '表达地道'])
    expect(task.focus).toBe('主题翻译')
    expect(task.mustUse).toEqual([])
  })

  it('风味酸奶任务把参考译文塞进 model，目标块为空', () => {
    const task = makeProductionTask(
      { id: 'yogurt-1', zh: '你好。', goal: '逐句翻译', targets: [], reference: 'Hello.' },
      '风味酸奶',
      'yogurt',
    )
    expect(task.model).toBe('Hello.')
    expect(task.reference).toBe('Hello.')
    expect(task.mustUse).toEqual([])
    expect(task.focus).toBe('逐句翻译')
    expect(task.rubric).toHaveLength(3)
  })

  it('AI 题目包硬校验：数量 / 每题目标数 / 不重复', () => {
    const t1 = target()
    const t2 = target({ id: 't2', text: 'curb' })
    const good = [
      { id: 'p1', zh: '一', goal: '', targets: [t1] },
      { id: 'p2', zh: '二', goal: '', targets: [t2] },
    ]
    expect(validateProductionPack(good, 2, 1)).toEqual({ ok: true, reason: '' })
    expect(validateProductionPack(good.slice(0, 1), 2, 1).ok).toBe(false)
    expect(validateProductionPack([{ ...good[0], targets: [t1, t2] }], 1, 1).ok).toBe(false)
    expect(validateProductionPack([good[0], { ...good[1], targets: [t1] }], 2, 1).ok).toBe(false)
    expect(validateTopicPack(good, 2).ok).toBe(true)
    expect(validateTopicPack(good, 3).ok).toBe(false)
  })

  it('进度范围：weak / due / mistakes 用 attempts 现算的进度筛选', () => {
    const weak = vocabItem({ id: 'v1', word: 'run', lemma: 'run', meaning: '跑' })
    const strong = vocabItem({ id: 'v2', word: 'curb', lemma: 'curb', meaning: '抑制' })
    const progress = [
      { key: 'word:run', kind: 'word' as const, text: 'run', attempts: 2, hits: 0, misses: 2, lastAt: '2026-11-01T00:00:00.000Z', dueAt: '2026-11-01T00:00:00.000Z' },
      { key: 'word:curb', kind: 'word' as const, text: 'curb', attempts: 2, hits: 2, misses: 0, lastAt: '2026-11-01T00:00:00.000Z', dueAt: '2027-01-01T00:00:00.000Z' },
    ]
    const opts = {
      items: [weak, strong],
      articleIdentity: 'A',
      docLemmas: new Set<string>(),
      types: ['word' as const],
      limit: 2,
      weakRatio: 0,
      progress,
      nowIso: '2026-11-05T00:00:00.000Z',
      rng: () => 0,
    }
    expect(buildProductionTargets({ ...opts, scope: 'weak' }).targets.map((t) => t.text)).toEqual(['run'])
    expect(buildProductionTargets({ ...opts, scope: 'mistakes' }).targets.map((t) => t.text)).toEqual(['run'])
    expect(buildProductionTargets({ ...opts, scope: 'due' }).targets.map((t) => t.text)).toEqual(['run'])
    expect(buildProductionTargets({ ...opts, scope: 'recent' }).targets.map((t) => t.text)).toEqual(
      expect.arrayContaining(['run', 'curb']),
    )
  })

  it('正文词 + 语言点词都算本篇 lemma', () => {
    const s = sentenceFixture('s1', 'A run.', {
      vocab: ['run'],
      languages: [{ phrases: ['run out'], idioms: ['run in the family'] }],
    })
    expect([...productionDocLemmas([s])].sort()).toEqual(['run', 'run in the family', 'run out'])
  })
})
