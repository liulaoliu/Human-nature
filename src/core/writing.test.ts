import { describe, it, expect } from 'vitest'
import {
  addWritingRecord,
  buildImitationTaskPrompt,
  countWritesOnDay,
  isGoldenWritingRecord,
  buildWritingFeedbackPrompt,
  parseImitationTask,
  parseWritingFeedback,
  writingHistoryToMarkdown,
  writingHistoryToPrintHTML,
  writingRecordLabel,
  writingAttemptsFor,
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

describe('writingHistoryToMarkdown（批改成册）', () => {
  const record = (over: Partial<WritingRecord> = {}): WritingRecord => ({
    at: '2026-10-29T06:12:30.000Z',
    articleId: 'saved:1',
    articleTitle: 'A long road',
    model: 'The more we learn, the less we know.',
    text: 'The more I read, the less I fear.',
    task: { task: '仿写 the more… the more…', model: 'M', mustUse: [], rubric: [] },
    feedback: {
      scores: [{ dimension: '结构', score: 4, max: 5, comment: '对称没问题' }],
      issues: [{ original: 'less I fear', suggestion: 'the less afraid I am', reason: '结构一致' }],
      polished: 'The more I read, the less afraid I am.',
      summary: '整体不错，注意平行结构。',
      total: 4,
      max: 5,
    },
    source: 'goldenSentence',
    ...over,
  })

  it('按时间倒序，带上分数 / 问题 / 润色 / 总评', () => {
    const md = writingHistoryToMarkdown([
      record(),
      record({ at: '2026-10-28T06:00:00.000Z', source: 'goldenExam', articleTitle: 'B 篇' }),
    ])
    expect(md.startsWith('# 仿写批改记录')).toBe(true)
    expect(md).toContain('共 2 条')
    expect(md.indexOf('2026-10-29')).toBeLessThan(md.indexOf('2026-10-28'))
    expect(md).toContain('单句仿写')
    expect(md).toContain('整课考试')
    expect(md).toContain('**评分**：4/5')
    expect(md).toContain('结构 4/5 — 对称没问题')
    expect(md).toContain('「less I fear」→「the less afraid I am」 — 结构一致')
    expect(md).toContain('**润色版**：The more I read, the less afraid I am.')
    expect(md).toContain('**总评**：整体不错，注意平行结构。')
  })

  it('空记录 / 缺字段不崩、不臆造', () => {
    expect(writingHistoryToMarkdown([])).toContain('共 0 条')
    const md = writingHistoryToMarkdown([
      record({ text: '', feedback: { scores: [], issues: [], total: 0, max: 0 }, task: undefined, model: '' }),
    ])
    expect(md).not.toContain('**评分**')
    expect(md).not.toContain('**我的作答**')
    expect(md).toContain('A long road')
  })

  it('A4 打印 HTML：含样式、分数、逐条问题，且转义尖括号', () => {
    const html = writingHistoryToPrintHTML([
      record({ text: 'a < b & c', feedback: {
        scores: [{ dimension: '结构', score: 4, max: 5 }],
        issues: [{ original: '<x>', suggestion: 'y', reason: 'z' }],
        polished: 'p', summary: 's', total: 4, max: 5,
      } }),
    ])
    expect(html).toContain('@page { size: A4')
    expect(html).toContain('共 1 条')
    expect(html).toContain('4/5')
    expect(html).toContain('结构 4/5')
    expect(html).toContain('&lt;x&gt; → y（z）')
    expect(html).toContain('a &lt; b &amp; c')
    expect(html).toContain('润色：p')
    expect(html).toContain('总评：s')
  })

  it('A4 打印空记录也不崩', () => {
    const html = writingHistoryToPrintHTML([])
    expect(html).toContain('共 0 条')
    expect(html).toContain('</html>')
  })
})

describe('writingRecordLabel：一条记录叫什么', () => {
  const base = { at: '2026-10-29T00:00:00.000Z', articleId: 'a1', model: 'M', text: 'T',
    feedback: { scores: [], issues: [], total: 0, max: 0 } }
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

  it('语言点造句在 Markdown / A4 打印里也标出来', () => {
    const rec = { ...base, at: '2026-10-29T06:00:00.000Z',
      source: 'goldenSentence' as const,
      task: { task: '用 come with 造句', model: 'M', mustUse: ['come with'], rubric: [], focus: 'come with' } }
    expect(writingHistoryToMarkdown([rec])).toContain('语言点造句 · come with')
    expect(writingHistoryToPrintHTML([rec])).toContain('语言点造句 · come with')
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
