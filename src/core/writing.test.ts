import { describe, it, expect } from 'vitest'
import {
  addWritingRecord,
  buildImitationTaskPrompt,
  countWritesOnDay,
  historyPage,
  isGoldenWritingRecord,
  normalizeWritingRecord,
  buildWritingFeedbackPrompt,
  parseImitationTask,
  parseWritingFeedback,
  writingRecordLabel,
  writingAttemptsFor,
  WRITING_HISTORY_PAGE,
  WRITING_HISTORY_WARN_AT,
  type ImitationTask,
  type WritingRecord,
} from './writing'

describe('buildImitationTaskPrompt', () => {
  it('含范句、rubric、必须用上的词、JSON schema', () => {
    const p = buildImitationTaskPrompt({
      model: 'The more we learn, the less we know.',
      structure: 'the more… the more…',
      mustUse: ['the more', 'the less'],
    })
    expect(p).toContain('The more we learn, the less we know.')
    expect(p).toContain('the more')
    expect(p).toContain('"rubric"')
  })
})

describe('parseImitationTask', () => {
  it('解析合法 JSON（含栅欄）', () => {
    const raw =
      '```json\n{"task":"写 3 句","model":"M","structure":"S","mustUse":["a","b"],"rubric":[{"dimension":"语法","weight":40,"description":"..."}]}\n```'
    const t = parseImitationTask(raw)
    expect(t).toMatchObject({ task: '写 3 句', model: 'M', mustUse: ['a', 'b'] })
    expect(t?.rubric[0]).toMatchObject({ dimension: '语法', weight: 40 })
  })
  it('缺 task/model → null', () => {
    expect(parseImitationTask(JSON.stringify({ task: 'x' }))).toBeNull()
    expect(parseImitationTask('not json')).toBeNull()
  })
})

describe('buildWritingFeedbackPrompt', () => {
  const task: ImitationTask = {
    task: '写 3 句',
    model: 'M',
    mustUse: ['a'],
    rubric: [{ dimension: '语法准确', weight: 40 }],
  }
  it('含严格规则、评分标准、学生作答、JSON schema', () => {
    const p = buildWritingFeedbackPrompt(task, 'I go to school yesterday.')
    expect(p).toContain('不要客套')
    expect(p).toContain('语法准确（满分 40）')
    expect(p).toContain('I go to school yesterday.')
    expect(p).toContain('"polished"')
  })
})

describe('parseWritingFeedback', () => {
  it('解析分数 + issues + polished', () => {
    const raw = JSON.stringify({
      scores: [{ dimension: '语法准确', score: 30, max: 40, comment: '时态错' }],
      total: 30,
      max: 40,
      issues: [{ original: 'go', suggestion: 'went', reason: '过去时间用过去式' }],
      polished: 'I went to school yesterday.',
      summary: '注意时态。',
    })
    const f = parseWritingFeedback(raw)
    expect(f?.total).toBe(30)
    expect(f?.issues[0]).toMatchObject({ original: 'go', suggestion: 'went' })
    expect(f?.polished).toContain('went')
  })
  it('没有 scores/issues → null；非法 JSON → null', () => {
    expect(parseWritingFeedback(JSON.stringify({ summary: 'x' }))).toBeNull()
    expect(parseWritingFeedback('nope')).toBeNull()
  })
})

describe('countWritesOnDay', () => {
  const rec = (at: string): WritingRecord => ({
    at,
    articleId: 'a',
    model: 'M',
    text: 'T',
    feedback: { scores: [], issues: [], total: 0, max: 0 },
  })
  it('只数逻辑日当天（04:00 结算）', () => {
    const list = [rec(new Date(2026, 9, 20, 9).toISOString()), rec(new Date(2026, 9, 20, 2).toISOString())]
    expect(countWritesOnDay(list, '2026-10-20')).toBe(1)
    expect(countWritesOnDay(list, '2026-10-19')).toBe(1)
  })
  it('坏时间戳忽略，不抛错', () => {
    expect(countWritesOnDay([rec('不是时间')], '2026-10-20')).toBe(0)
  })
})

describe('isGoldenWritingRecord', () => {
  const rec = (source?: WritingRecord['source']): WritingRecord => ({
    at: '2026-10-28T00:00:00.000Z',
    articleId: 'a',
    model: 'M',
    text: 'T',
    feedback: { scores: [], issues: [], total: 0, max: 0 },
    ...(source ? { source } : {}),
  })
  it('单句仿写和整课考试都算金句课记录', () => {
    expect(isGoldenWritingRecord(rec('goldenSentence'))).toBe(true)
    expect(isGoldenWritingRecord(rec('goldenExam'))).toBe(true)
    expect(isGoldenWritingRecord(rec())).toBe(false)
    expect(isGoldenWritingRecord(rec('writing'))).toBe(false)
  })
})

describe('addWritingRecord', () => {
  const rec = (at: string): WritingRecord => ({
    at,
    articleId: 'a',
    model: 'M',
    text: 'T',
    feedback: { scores: [], issues: [], total: 0, max: 0 },
  })
  it('新记录插到最前', () => {
    expect(addWritingRecord([rec('1')], rec('2')).map((r) => r.at)).toEqual(['2', '1'])
  })
  it('默认不截断（真丢数据），只在超过提醒线时提示导出', () => {
    let list: WritingRecord[] = []
    for (let i = 0; i < 300; i++) list = addWritingRecord(list, rec(String(i)))
    expect(list).toHaveLength(300)
    for (let i = 300; i < WRITING_HISTORY_WARN_AT + 5; i++) list = addWritingRecord(list, rec(String(i)))
    // 超过提醒线也照收，不能悄悄把旧批改截掉
    expect(list).toHaveLength(WRITING_HISTORY_WARN_AT + 5)
  })

  it('超过上限截断', () => {
    let list: WritingRecord[] = []
    for (let i = 0; i < 5; i++) list = addWritingRecord(list, rec(String(i)), 3)
    expect(list).toHaveLength(3)
    expect(list.map((r) => r.at)).toEqual(['4', '3', '2'])
  })
})

describe('writingRecordLabel：一条记录叫什么', () => {
  it('普通仿写 / 整课考试 / 单句仿写 / 语言点造句各叫各的', () => {
    expect(writingRecordLabel({ source: 'writing', task: undefined })).toBe('仿写')
    expect(writingRecordLabel({ source: 'goldenExam', task: undefined })).toBe('整课考试')
    expect(writingRecordLabel({ source: 'goldenSentence', task: { task: 'x', model: 'm', mustUse: [], rubric: [] } })).toBe('单句仿写')
    expect(
      writingRecordLabel({
        source: 'goldenSentence',
        task: { task: 'x', model: 'm', mustUse: ['come with'], rubric: [], focus: 'come with' },
      }),
    ).toBe('语言点造句 · come with')
  })
  it('第二稿在名字里标出来（第 2 稿）', () => {
    expect(
      writingRecordLabel({
        source: 'goldenSentence',
        task: { task: 'x', model: 'm', mustUse: ['come with'], rubric: [], focus: 'come with', round: 2 },
      }),
    ).toBe('语言点造句 · come with（第 2 稿）')
    expect(writingRecordLabel({ source: 'goldenSentence', task: { task: 'x', model: 'm', mustUse: [], rubric: [], round: 2 } })).toBe(
      '单句仿写（第 2 稿）',
    )
  })

})

describe('normalizeWritingRecord：外部数据里的来源只认白名单', () => {
  const base: WritingRecord = {
    at: '2026-10-30T00:00:00.000Z',
    articleId: 'a1',
    model: 'M',
    text: 'T',
    feedback: { scores: [], issues: [], total: 0, max: 0 },
  }
  it('合法来源原样保留（金句课历史才会出现在 D老师小课堂）', () => {
    expect(normalizeWritingRecord({ ...base, source: 'goldenExam', examId: 'e1' }).source).toBe('goldenExam')
    expect(normalizeWritingRecord({ ...base, source: 'goldenSentence', sentenceId: 's1' }).sentenceId).toBe('s1')
    expect(normalizeWritingRecord({ ...base, source: 'writing' }).source).toBe('writing')
  })

  it('坏来源当普通仿写；id 不是字符串就丢掉（和服务端 sqliteLearning 同一口径）', () => {
    const bad = normalizeWritingRecord({
      ...base,
      source: 'bogus' as WritingRecord['source'],
      sentenceId: 42 as unknown as string,
      examId: { x: 1 } as unknown as string,
    })
    expect(bad.source).toBeUndefined()
    expect(bad.sentenceId).toBeUndefined()
    expect(bad.examId).toBeUndefined()
  })
})

describe('historyPage：学习历史只分页显示，不删记录', () => {
  it('默认一页 100 条，返回剩余条数和下一页上限', () => {
    const list = Array.from({ length: 250 }, (_, i) => i)
    const res = historyPage(list, WRITING_HISTORY_PAGE)
    expect(res.rows).toHaveLength(100)
    expect(res.rows[0]).toBe(0)
    expect(res.rest).toBe(150)
    expect(res.next).toBe(200)
  })

  it('点「显示更多」翻倍；到底了 rest = 0', () => {
    const list = Array.from({ length: 250 }, (_, i) => i)
    expect(historyPage(list, 200).rest).toBe(50)
    const done = historyPage(list, 300)
    expect(done.rows).toHaveLength(250)
    expect(done.rest).toBe(0)
  })

  it('空列表 / 坏入参不崩（shown 非数字按一页算，小于一页按一页算）', () => {
    expect(historyPage([], 200)).toEqual({ rows: [], rest: 0, next: 300 })
    expect(historyPage([1, 2, 3], Number.NaN).rows).toHaveLength(3)
    expect(historyPage([1, 2, 3], 0).rows).toHaveLength(3)
  })
})

describe('writingAttemptsFor：同一题的历史批改', () => {
  const r = (at: string, over: Record<string, unknown> = {}) => ({
    at,
    articleId: 'a1',
    sentenceId: 's1',
    model: 'M',
    text: 'T',
    feedback: { scores: [], issues: [], total: 0, max: 0 },
    ...over,
  })
  it('只取同篇同句同 focus，按时间正序（最后一条是最新）', () => {
    const list = [
      r('2026-10-29T02:00:00.000Z', { text: 'second', task: { task: 'x', model: 'M', mustUse: [], rubric: [], focus: 'come with' } }),
      r('2026-10-29T01:00:00.000Z', { text: 'first', task: { task: 'x', model: 'M', mustUse: [], rubric: [], focus: 'come with' } }),
      r('2026-10-29T03:00:00.000Z', { text: 'other focus', task: { task: 'x', model: 'M', mustUse: [], rubric: [], focus: 'served' } }),
      r('2026-10-29T04:00:00.000Z', { articleId: 'a2', text: 'other article' }),
      r('2026-10-29T05:00:00.000Z', { sentenceId: 's2', text: 'other sentence' }),
    ]
    expect(writingAttemptsFor(list, { articleId: 'a1', sentenceId: 's1', focus: 'come with' }).map((x) => x.text)).toEqual(['first', 'second'])
  })
  it('整课考试按 examId 取', () => {
    const list = [r('2026-10-29T01:00:00.000Z', { examId: 'e1' }), r('2026-10-29T02:00:00.000Z', { examId: 'e2' })]
    expect(writingAttemptsFor(list, { articleId: 'a1', examId: 'e1' })).toHaveLength(1)
  })
})
