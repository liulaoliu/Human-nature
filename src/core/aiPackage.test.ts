import { describe, it, expect } from 'vitest'
import {
  buildAiJobs,
  buildJobPack,
  buildWebPackPrompt,
  chunk,
  countAiJobs,
  isAiJobTask,
  makeJobId,
  missingJobIds,
  parseAiResultPack,
  parseJobPack,
  parseWebPackResults,
  type AiJob,
  type AiJobsInput,
} from './aiPackage'
import type { Sentence, VocabItem } from '../types/document'

const review = () => ({ ease: 2.5, due: null, interval: 0, repetitions: 0 })

const mkItem = (over: Partial<VocabItem> = {}): VocabItem => ({
  id: over.word ?? 'w',
  word: 'word',
  lemma: 'word',
  phonetic: '/w/',
  partOfSpeech: 'n.',
  meaning: '词',
  usage: [],
  examples: [],
  source: null,
  status: 'queried',
  note: '',
  tags: [],
  reviewState: review(),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

const mkSentence = (over: Partial<Sentence> = {}): Sentence => ({
  id: 's1',
  paraId: 'p1',
  text: 'Hello.',
  audio: null,
  translation: null,
  grammarNote: null,
  collocations: [],
  vocab: [],
  tags: [],
  reviewState: review(),
  ...over,
})

const emptyInput = (over: Partial<AiJobsInput> = {}): AiJobsInput => ({
  batch: [],
  items: [],
  confusableTodo: [],
  confusableBatchSize: 0,
  lemmaCandidates: [],
  posCandidates: [],
  sentences: [],
  vocabLevel: 'cet6',
  hasListenQuiz: false,
  listenCount: 8,
  ...over,
})

const job = (over: Partial<AiJob> = {}): AiJob => ({
  id: 'lookup-1',
  task: 'lookup',
  label: '批量查词（2）',
  askedWords: ['abandon', 'benefit'],
  askedIds: [],
  prompt: 'PROMPT',
  ...over,
})

describe('isAiJobTask / makeJobId', () => {
  it('识别合法任务', () => {
    expect(isAiJobTask('lookup')).toBe(true)
    expect(isAiJobTask('confusable')).toBe(true)
    expect(isAiJobTask('nope')).toBe(false)
    expect(isAiJobTask(3)).toBe(false)
  })
  it('生成稳定 id', () => {
    expect(makeJobId('pos', 7)).toBe('pos-7')
  })
})

describe('chunk', () => {
  it('按 size 切块', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
  it('size<=0 不切；空数组不产块', () => {
    expect(chunk([1, 2, 3], 0)).toEqual([[1, 2, 3]])
    expect(chunk([], 0)).toEqual([])
    expect(chunk([], 3)).toEqual([])
  })
})

describe('buildJobPack / parseJobPack', () => {
  it('打包后可原样解析回来', () => {
    const pack = buildJobPack([job()], new Date('2026-10-04T00:00:00Z'))
    expect(pack.version).toBe(1)
    expect(pack.exportedAt).toBe('2026-10-04T00:00:00.000Z')
    const back = parseJobPack(JSON.stringify(pack))
    expect(back?.jobs).toHaveLength(1)
    expect(back?.jobs[0]).toEqual(job())
  })
  it('坏输入返回 null', () => {
    expect(parseJobPack('not json')).toBeNull()
    expect(parseJobPack('{"jobs":[]}')).toBeNull()
    expect(parseJobPack('{"jobs":[{"id":1,"task":"lookup"}]}')).toBeNull()
  })
})

describe('parseAiResultPack', () => {
  it('接受 {results:[{id,raw}]}', () => {
    const { results, error } = parseAiResultPack(
      JSON.stringify({ results: [{ id: 'lookup-1', raw: 'abandon | v. 放弃' }] }),
    )
    expect(error).toBe('')
    expect(results).toEqual([{ id: 'lookup-1', raw: 'abandon | v. 放弃' }])
  })
  it('接受裸数组与 text/content 别名', () => {
    const { results } = parseAiResultPack(JSON.stringify([{ id: 'a', text: 'X' }]))
    expect(results).toEqual([{ id: 'a', raw: 'X' }])
    const { results: r2 } = parseAiResultPack(JSON.stringify({ results: [{ id: 'b', content: 'Y' }] }))
    expect(r2).toEqual([{ id: 'b', raw: 'Y' }])
  })
  it('接受单条对象', () => {
    const { results } = parseAiResultPack(JSON.stringify({ id: 'x', raw: 'Z' }))
    expect(results).toEqual([{ id: 'x', raw: 'Z' }])
  })
  it('保留可选 task / askedWords', () => {
    const { results } = parseAiResultPack(
      JSON.stringify({ results: [{ id: 'c', task: 'confusable', askedWords: ['cat', 3], raw: 'c' }] }),
    )
    expect(results[0].task).toBe('confusable')
    expect(results[0].askedWords).toEqual(['cat'])
  })
  it('过滤空的 raw', () => {
    const { results, error } = parseAiResultPack(
      JSON.stringify({ results: [{ id: 'a', raw: '  ' }, { id: 'b', raw: 'ok' }] }),
    )
    expect(results.map((r) => r.id)).toEqual(['b'])
    expect(error).toBe('')
  })
  it('错误信息', () => {
    expect(parseAiResultPack('nope').error).toBe('不是合法 JSON')
    expect(parseAiResultPack('{}').error).toBe('缺少 results 数组')
    expect(parseAiResultPack('{"results":[]}').error).toBe('没有有效的 raw 文本')
  })
})

describe('buildAiJobs / countAiJobs', () => {
  it('空数据没有待办', () => {
    expect(buildAiJobs(emptyInput())).toEqual([])
    expect(countAiJobs(emptyInput())).toBe(0)
  })

  it('待选 → 一条批量查词，带 askedWords', () => {
    const jobs = buildAiJobs(emptyInput({ batch: [{ word: 'alpha', sentence: 'A.' }, { word: 'beta' }] }))
    expect(jobs).toHaveLength(1)
    expect(jobs[0].task).toBe('lookup')
    expect(jobs[0].askedWords).toEqual(['alpha', 'beta'])
    expect(jobs[0].id).toBe('lookup-1')
    expect(jobs[0].prompt).toContain('alpha')
  })

  it('缺音标/释义按 30 个一份分块', () => {
    const items = Array.from({ length: 65 }, (_, i) => mkItem({ word: `w${i}`, phonetic: null }))
    const jobs = buildAiJobs(emptyInput({ items }))
    expect(jobs.filter((j) => j.task === 'lookup')).toHaveLength(3)
    expect(jobs[0].askedWords).toHaveLength(30)
    expect(jobs[2].askedWords).toHaveLength(5)
  })

  it('有音标有释义的词不算待办', () => {
    const items = [mkItem({ word: 'ok', phonetic: '/o/', meaning: '行了' })]
    const jobs = buildAiJobs(emptyInput({ items }))
    expect(jobs).toHaveLength(0)
  })

  it('混淆项按 batchSize 分批；0 表示全部一批', () => {
    const todo = Array.from({ length: 5 }, (_, i) => mkItem({ word: `c${i}` }))
    expect(buildAiJobs(emptyInput({ confusableTodo: todo, confusableBatchSize: 2 })).filter((j) => j.task === 'confusable')).toHaveLength(3)
    expect(buildAiJobs(emptyInput({ confusableTodo: todo, confusableBatchSize: 0 })).filter((j) => j.task === 'confusable')).toHaveLength(1)
  })

  it('原形 / -ing-ed 各一条', () => {
    const jobs = buildAiJobs(
      emptyInput({ lemmaCandidates: [mkItem({ word: 'running' })], posCandidates: [mkItem({ word: 'bored' })] }),
    )
    expect(jobs.map((j) => j.task).sort()).toEqual(['lemma', 'pos'])
  })

  it('缺译文/语言点/听力各生成一条，带句子 id', () => {
    const sentences = [mkSentence({ id: 's1' }), mkSentence({ id: 's2', translation: '你好', language: { grammar: 'x' } })]
    const jobs = buildAiJobs(emptyInput({ sentences, hasListenQuiz: false, listenCount: 6 }))
    const translate = jobs.find((j) => j.task === 'translate')
    const language = jobs.find((j) => j.task === 'language')
    const listening = jobs.find((j) => j.task === 'listening')
    expect(translate?.askedIds).toEqual(['s1'])
    expect(language?.askedIds).toEqual(['s1'])
    expect(listening?.label).toContain('6')
  })

  it('已有听力题就不再打包听力', () => {
    const jobs = buildAiJobs(emptyInput({ sentences: [mkSentence({ translation: 'x', language: {} })], hasListenQuiz: true }))
    expect(jobs.find((j) => j.task === 'listening')).toBeUndefined()
  })

  it('有文章句子 → 生成一条自动标词', () => {
    const jobs = buildAiJobs(emptyInput({ sentences: [mkSentence({ id: 's1' })] }))
    const auto = jobs.find((j) => j.task === 'auto_vocab')
    expect(auto).toBeTruthy()
    expect(auto?.label).toContain('cet6')
  })

  it('翻译/语言点按句分块（避免单条太大被截断）', () => {
    const sentences = Array.from({ length: 13 }, (_, i) => mkSentence({ id: `s${i}` }))
    const jobs = buildAiJobs(emptyInput({ sentences, hasListenQuiz: true }))
    expect(jobs.filter((j) => j.task === 'translate')).toHaveLength(3)
    expect(jobs.filter((j) => j.task === 'language')).toHaveLength(3)
    expect(jobs.find((j) => j.task === 'translate')?.askedIds).toHaveLength(6)
    expect(jobs.filter((j) => j.task === 'translate')[2].askedIds).toHaveLength(1)
  })

  it('countAiJobs 与 buildAiJobs 数量一致', () => {
    const input = emptyInput({
      batch: [{ word: 'a' }],
      items: Array.from({ length: 40 }, (_, i) => mkItem({ word: `w${i}`, meaning: null })),
      confusableTodo: [mkItem({ word: 'x' })],
      lemmaCandidates: [mkItem({ word: 'y' })],
      posCandidates: [mkItem({ word: 'z' })],
      sentences: [mkSentence()],
      listenCount: 8,
    })
    expect(countAiJobs(input)).toBe(buildAiJobs(input).length)
  })

  it('id 在各任务内递增且唯一', () => {
    const jobs = buildAiJobs(emptyInput({ batch: [{ word: 'a' }], lemmaCandidates: [mkItem()], posCandidates: [mkItem()] }))
    const ids = jobs.map((j) => j.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('buildWebPackPrompt / parseWebPackResults', () => {
  it('拼出一条含任务与分隔符说明的提示词', () => {
    const p = buildWebPackPrompt([job({ id: 'lookup-1' }), job({ id: 'confusable-2', task: 'confusable' })])
    expect(p).toContain('@@@ANSWER 任务id')
    expect(p).toContain('----- 任务 lookup-1')
    expect(p).toContain('----- 任务 confusable-2')
    expect(p).toContain('PROMPT')
  })
  it('分批时标注第几批', () => {
    const p = buildWebPackPrompt([job()], { batchIndex: 2, batchCount: 3, remaining: 5 })
    expect(p).toContain('第 2 / 3 批')
    expect(p).toContain('还有 5 个任务')
  })
  it('按 @@@ANSWER 切出各任务答案', () => {
    const text = [
      '好的，这是结果：',
      '@@@ANSWER lookup-1',
      'abandon | v. 放弃',
      '@@@END',
      '@@@ANSWER confusable-2',
      'run | 跑；经营',
      '@@@END',
    ].join('\n')
    const r = parseWebPackResults(text)
    expect(r).toEqual([
      { id: 'lookup-1', raw: 'abandon | v. 放弃' },
      { id: 'confusable-2', raw: 'run | 跑；经营' },
    ])
  })
  it('容忍缺 @@@END（截断）与代码围栏', () => {
    const text = '@@@ANSWER a-1\n```\nX\n```\n@@@ANSWER a-2\nY'
    const r = parseWebPackResults(text)
    expect(r).toEqual([
      { id: 'a-1', raw: 'X' },
      { id: 'a-2', raw: 'Y' },
    ])
  })
  it('没有分隔符时退回严格 JSON', () => {
    const r = parseWebPackResults('{"results":[{"id":"z-1","raw":"ok"}]}')
    expect(r).toEqual([{ id: 'z-1', raw: 'ok' }])
  })
  it('missingJobIds 找出没返回的', () => {
    const jobs = [job({ id: 'a-1' }), job({ id: 'b-2' })]
    expect(missingJobIds(jobs, [{ id: 'a-1' }])).toEqual(['b-2'])
    expect(missingJobIds(jobs, [])).toEqual(['a-1', 'b-2'])
  })
})
