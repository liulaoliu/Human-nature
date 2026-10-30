import { describe, expect, it } from 'vitest'
import { writingHistoryToMarkdown, writingHistoryToPrintHTML } from './writingExport'
import type { WritingRecord } from './writing'

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

describe('导出的「一条记录叫什么」沿用 writingRecordLabel 口径', () => {
  it('语言点造句在 Markdown / A4 打印里也标出来', () => {
    const rec: WritingRecord = {
      at: '2026-10-29T06:00:00.000Z',
      articleId: 'a1',
      model: 'M',
      text: 'T',
      feedback: { scores: [], issues: [], total: 0, max: 0 },
      source: 'goldenSentence',
      task: { task: '用 come with 造句', model: 'M', mustUse: ['come with'], rubric: [], focus: 'come with' } }
    expect(writingHistoryToMarkdown([rec])).toContain('语言点造句 · come with')
    expect(writingHistoryToPrintHTML([rec])).toContain('语言点造句 · come with')
  })
})
