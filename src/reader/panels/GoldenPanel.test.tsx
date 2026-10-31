// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeStorage } from '../testStorage'
import GoldenPanel from './GoldenPanel'
import type { useGoldenDrill } from '../hooks/useGoldenDrill'
import type { GoldenImitationApi } from './golden/types'
import type { GoldenBankRow } from '../../core/goldenBank'

function fakeApi(over: Record<string, unknown> = {}) {
  return {
    open: true,
    view: 'home',
    setView: vi.fn(),
    close: vi.fn(),
    doc: null,
    lesson: {
      version: 1,
      source: 'local',
      outline: [{ paraId: 'p01', role: 'intro', points: ['导入'] }],
      sentences: [],
      selected: [],
      options: { pick: 'recommended' },
    },
    ordered: [],
    candidates: [],
    summary: { selectedSentences: 0, masteredSentences: 0, totalTargets: 0, masteredTargets: 0, byKind: [], bySection: [] },
    progressFor: () => null,
    startDrill: vi.fn(),
    startRecall: vi.fn(),
    prevSentence: vi.fn(),
    nextSentence: vi.fn(),
    ...over,
  } as unknown as ReturnType<typeof useGoldenDrill>
}

function drillApi(over: Record<string, unknown> = {}) {
  const target = { en: 'keep up with', zh: '跟上', kind: 'idiom' as const }
  const current = { id: 's1', zh: '我们要跟上新闻。', targets: [target] }
  const one = {
    sentence: 'We keep up with the news.',
    parts: [
      { text: 'We keep up ', blank: false },
      { text: 'with', blank: true, targetIndex: 0, blankIndex: 1 },
      { text: ' the news.', blank: false },
    ],
    blanks: [{ index: 1, targetIndex: 0, wordIndex: 2, answer: 'with', hint: '跟上', kind: 'idiom' }],
    targets: [target],
  }
  return fakeApi({
    view: 'drill',
    phase: 'fill',
    current,
    currentSentence: { id: 's1', text: 'We keep up with the news.' },
    ordered: [current],
    index: 0,
    cloze: one,
    fillInputs: [],
    setFillInputs: vi.fn(),
    checkFill: vi.fn(),
    fillCorrect: null,
    fillChecked: null,
    fillRound: 0,
    fillRoundCount: 2,
    fillRoundPassed: false,
    nextFillRound: vi.fn(),
    setPhase: vi.fn(),
    beginAssemble: vi.fn(),
    assembly: null,
    assembleOrder: [],
    setAssembleOrder: vi.fn(),
    checkAssemble: vi.fn(),
    assembleChecked: null,
    speakCurrent: vi.fn(),
    restartSentence: vi.fn(),
    nextSentence: vi.fn(),
    markSummary: vi.fn(),
    setView: vi.fn(),
    ...over,
  })
}

function fakeImitation(over: Record<string, unknown> = {}) {
  return {
    current: null,
    answer: '',
    setAnswer: vi.fn(),
    grade: vi.fn(),
    grading: false,
    error: '',
    feedback: null,
    copyGradePrompt: vi.fn(),
    applyGrade: vi.fn(),
    reset: vi.fn(),
    attempts: [],
    viewing: null,
    earlier: vi.fn(),
    later: vi.fn(),
    backToLive: vi.fn(),
    round: 1,
    canRewrite: false,
    rewrite: vi.fn(),
    ...over,
  } as unknown as GoldenImitationApi
}

let restoreStorage = () => {}
beforeEach(() => {
  restoreStorage = installFakeStorage()
})
afterEach(() => {
  restoreStorage()
})

describe('GoldenPanel', () => {
  it('课程页展示三个 STEP 和素材总结；点梳理思路切到选金句', () => {
    const api = fakeApi()
    render(<GoldenPanel api={api} articleTitle="A" onSpeak={vi.fn()} actions={{ onExportMarkdown: vi.fn() }} />)
    expect(screen.getByText('D老师小课堂')).toBeTruthy()
    expect(screen.getByText('梳理思路')).toBeTruthy()
    expect(screen.getByText('遣词造句')).toBeTruthy()
    expect(screen.getByText('逆向回顾')).toBeTruthy()
    expect(screen.getByText('本课素材总结')).toBeTruthy()
    fireEvent.click(screen.getByText('梳理思路'))
    expect(api.setView).toHaveBeenCalledWith('plan')
  })

  it('未选金句时，遣词造句 / 逆向回顾禁用', () => {
    const api = fakeApi()
    render(<GoldenPanel api={api} articleTitle="A" onSpeak={vi.fn()} actions={{ onExportMarkdown: vi.fn() }} />)
    expect((screen.getByText('遣词造句').closest('button') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('逆向回顾').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('全库金句本收一个 bank 对象，导出动作直接接上', () => {
    const api = fakeApi({ view: 'bank' })
    const rows = [{
      articleId: 'a1',
      articleTitle: 'A 篇',
      sentenceId: 's1',
      text: 'Team spirit is one of the main factors.',
      zh: '团队精神是主要因素之一。',
      targets: [],
      mastered: false,
      due: false,
    }] as GoldenBankRow[]
    const onExportMarkdown = vi.fn()
    render(
      <GoldenPanel
        api={api}
        articleTitle="A"
        onSpeak={vi.fn()}
        actions={{ onExportMarkdown: vi.fn(), bank: { rows, onExportMarkdown } }}
      />,
    )
    expect(screen.getByText('全库金句本')).toBeTruthy()
    expect(screen.getByText('Team spirit is one of the main factors.')).toBeTruthy()
    fireEvent.click(screen.getByText('导出 Markdown'))
    expect(onExportMarkdown).toHaveBeenCalled()
  })

  it('课程页有「学习历史」入口，点开能看到本科的批改记录与详情', () => {
    const api = fakeApi({ view: 'home' })
    const setView = api.setView as unknown as ReturnType<typeof vi.fn>
    const rec = {
      at: '2026-10-29T06:12:30.000Z',
      articleId: 'a1',
      articleTitle: 'A',
      model: 'The more we learn…',
      text: 'The more I read…',
      task: { task: '仿写 the more…', model: 'The more we learn…', mustUse: [], rubric: [] },
      feedback: { scores: [{ dimension: '结构', score: 4, max: 5 }], issues: [], polished: '', summary: '不错', total: 4, max: 5 },
      source: 'goldenSentence' as const,
    }
    const { unmount } = render(
      <GoldenPanel
        api={api}
        articleTitle="A"
        onSpeak={vi.fn()}
        actions={{ onExportMarkdown: vi.fn(), history: { article: [rec], all: [rec] } }}
      />,
    )
    const entry = screen.getByRole('button', { name: /学习历史（1）/ })
    fireEvent.click(entry)
    expect(setView).toHaveBeenCalledWith('history')
    unmount()

    // 历史视图：默认本篇，列表 → 点开详情
    render(
      <GoldenPanel
        api={fakeApi({ view: 'history' })}
        articleTitle="A"
        onSpeak={vi.fn()}
        actions={{ onExportMarkdown: vi.fn(), history: { article: [rec], all: [rec] } }}
      />,
    )
    expect(screen.getByText('学习历史')).toBeTruthy()
    expect(screen.getByRole('button', { name: '本篇（1）' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '全部（1）' })).toBeTruthy()
    fireEvent.click(screen.getByTitle(/作答：The more I read/))
    expect(screen.getByText(/单句仿写/)).toBeTruthy()
    expect(screen.getByText('得分：4/5')).toBeTruthy()
    expect(screen.getByText('不错')).toBeTruthy()
  })

  it('错因复盘：本篇汇总规则 / 推荐，点「加入本课」回调', () => {
    const at = new Date().toISOString()
    const rec = {
      at,
      articleId: 'a1',
      articleTitle: 'A',
      model: 'M',
      text: 'I learn bureacracy.',
      source: 'goldenSentence' as const,
      sentenceId: 's1',
      task: { task: 'x', model: 'M', mustUse: [], rubric: [] },
      feedback: {
        version: 2 as const,
        scores: [{ dimension: '拼写', score: 30, max: 40 }],
        total: 30,
        max: 40,
        issues: [
          {
            original: 'bureacracy',
            suggestion: 'bureaucracy',
            reason: '拼写错误',
            type: 'spelling' as const,
            rule: 'word-spelling' as const,
            key: 'spelling-bureaucracy',
            severity: 'must-fix' as const,
          },
        ],
        recommendations: [
          {
            kind: 'chunk' as const,
            point: 'come to an end',
            zh: '结束',
            why: '你这次把 an end to 当成了独立词块',
            priority: 1 as const,
            from: 'error' as const,
            issueKey: 'chunk-come-to-an-end',
          },
        ],
      },
    }
    const setView = vi.fn()
    const onAddPoint = vi.fn()
    const onReviewAnswer = vi.fn()
    const errors = { onAddPoint, writingErrorProgress: [], onReviewAnswer }
    const { unmount } = render(
      <GoldenPanel
        api={fakeApi({ setView })}
        articleTitle="A"
        onSpeak={vi.fn()}
        actions={{ onExportMarkdown: vi.fn(), history: { article: [rec], all: [rec] }, errors }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /错因复盘/ }))
    expect(setView).toHaveBeenCalledWith('errors')
    unmount()

    render(
      <GoldenPanel
        api={fakeApi({ view: 'errors', setView })}
        articleTitle="A"
        onSpeak={vi.fn()}
        actions={{ onExportMarkdown: vi.fn(), history: { article: [rec], all: [rec] }, errors }}
      />,
    )
    expect(screen.getByText('单词拼写')).toBeTruthy()
    expect(screen.getByText('come to an end')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '加入本课' }))
    expect(onAddPoint).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /现在考我（1 张到期）/ }))
    expect(screen.getByText('错因复习')).toBeTruthy()
    expect(screen.getByLabelText('错因答案')).toBeTruthy()
  })

  it('学习历史：按语言点筛、详情翻上下一条、悬浮看摘要', () => {
    const mk = (at: string, focus: string, text: string, total: number) => ({
      at,
      articleId: 'a1',
      articleTitle: 'A',
      model: 'M',
      text,
      task: { task: 'x', model: 'M', mustUse: [focus], rubric: [], focus },
      feedback: { scores: [], issues: [], polished: '', summary: '总评', total, max: 5 },
      source: 'goldenSentence' as const,
    })
    const rows = [mk('2026-10-29T01:00:00.000Z', 'come with', 'first answer', 3), mk('2026-10-29T02:00:00.000Z', 'come with', 'second answer', 4), mk('2026-10-29T03:00:00.000Z', 'served', 'other answer', 5)]
    render(
      <GoldenPanel
        api={fakeApi({ view: 'history' })}
        articleTitle="A"
        onSpeak={vi.fn()}
        actions={{ onExportMarkdown: vi.fn(), history: { article: rows, all: rows } }}
      />,
    )
    // 悬浮摘要：带作答和评分
    expect(screen.getByTitle(/作答：second answer/)).toBeTruthy()

    // 按语言点筛：只剩 2 条
    fireEvent.change(screen.getByLabelText('按语言点筛选'), { target: { value: 'come with' } })
    expect(screen.getByText(/语言点「come with」· 2 条/)).toBeTruthy()
    expect(screen.queryByTitle(/作答：other answer/)).toBeNull()

    // 点开最新一条（列表按时间倒序，第一条是 second answer）
    fireEvent.click(screen.getByTitle(/作答：second answer/))
    expect(screen.getByText(/第 1\/2 条/)).toBeTruthy()
    const older = screen.getByRole('button', { name: /上一条/ }) as HTMLButtonElement
    expect(older.disabled).toBe(true) // 已是最新一条
    fireEvent.click(screen.getByRole('button', { name: /下一条/ }))
    expect(screen.getByText(/第 2\/2 条/)).toBeTruthy()
    expect(screen.getByText('first answer')).toBeTruthy()
  })

  it('切「全部」能看别的篇，默认不给', () => {
    const rec = {
      at: '2026-10-29T06:12:30.000Z',
      articleId: 'other',
      articleTitle: 'B 篇',
      model: 'M',
      text: 'T',
      feedback: { scores: [], issues: [], polished: '', summary: '别的篇', total: 3, max: 5 },
      source: 'goldenExam' as const,
    }
    render(
      <GoldenPanel
        api={fakeApi({ view: 'history' })}
        articleTitle="A"
        onSpeak={vi.fn()}
        actions={{ onExportMarkdown: vi.fn(), history: { article: [], all: [rec] } }}
      />,
    )
    // 默认本篇：空
    expect(screen.getByText(/本篇还没有记录/)).toBeTruthy()
    expect(screen.queryByText('B 篇')).toBeNull()
    // 切全部：出现，并显示文章标题
    fireEvent.click(screen.getByRole('button', { name: '全部（1）' }))
    expect(screen.getByText('B 篇')).toBeTruthy()
  })

  it('同一题多次批改：批改结果上方有翻页，能看上一次 / 回到最新', () => {
    const fb = (total: number) => ({ scores: [], issues: [], polished: '', summary: '', total, max: 5 })
    const attempts = [
      { at: '2026-10-29T06:00:00.000Z', articleId: 'a1', sentenceId: 's1', text: 'First try.', model: 'M', feedback: fb(3) },
      { at: '2026-10-29T06:10:00.000Z', articleId: 'a1', sentenceId: 's1', text: 'Second try.', model: 'M', feedback: fb(4) },
    ]
    const earlier = vi.fn()
    const backToLive = vi.fn()
    const imitation = fakeImitation({
      current: { id: 'exam:s1', sentenceId: 's1', task: '仿写', model: 'M', mustUse: [], rubric: [], source: 'local' },
      attempts,
      viewing: null,
      earlier,
      later: vi.fn(),
      backToLive,
      feedback: fb(4),
    })
    const { unmount } = render(
      <GoldenPanel
        api={drillApi({ phase: 'imitation' })}
        articleTitle="A"
        onSpeak={vi.fn()}
        actions={{ onExportMarkdown: vi.fn(), sentenceImitation: imitation }}
      />,
    )
    expect(screen.getByText(/第 2\/2 次批改/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /上一次/ }))
    expect(earlier).toHaveBeenCalled()
    unmount()

    // 翻到历史：只读、显示当时的作答，并且能回到最新
    render(
      <GoldenPanel
        api={drillApi({ phase: 'imitation' })}
        articleTitle="A"
        onSpeak={vi.fn()}
        actions={{
          onExportMarkdown: vi.fn(),
          sentenceImitation: fakeImitation({ ...imitation, viewing: attempts[0] }),
        }}
      />,
    )
    expect(screen.getByText(/当时的作答：First try\./)).toBeTruthy()
    expect(screen.getByRole('button', { name: '回到最新' })).toBeTruthy()
  })

  it('学习历史可打印：按当前范围（本篇 / 全部）传对应记录', () => {
    const rec = (at: string, articleId: string, articleTitle: string) => ({
      at,
      articleId,
      articleTitle,
      model: 'M',
      text: 'T',
      feedback: { scores: [], issues: [], polished: '', summary: '', total: 3, max: 5 },
      source: 'goldenSentence' as const,
    })
    const mine = rec('2026-10-29T06:00:00.000Z', 'a1', 'A')
    const other = rec('2026-10-28T06:00:00.000Z', 'a2', 'B 篇')
    const onPrintHistory = vi.fn()
    render(
      <GoldenPanel
        api={fakeApi({ view: 'history' })}
        articleTitle="A"
        onSpeak={vi.fn()}
        actions={{
          onExportMarkdown: vi.fn(),
          history: { article: [mine], all: [mine, other] },
          onPrintHistory,
        }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '打印' }))
    expect(onPrintHistory).toHaveBeenLastCalledWith([mine], 'A · 学习历史')

    fireEvent.click(screen.getByRole('button', { name: '全部（2）' }))
    fireEvent.click(screen.getByRole('button', { name: '打印' }))
    expect(onPrintHistory).toHaveBeenLastCalledWith([mine, other], '金句课学习历史')
  })

  it('没有历史时给出说明，不是空白', () => {
    render(
      <GoldenPanel
        api={fakeApi({ view: 'history' })}
        articleTitle="A"
        onSpeak={vi.fn()}
        actions={{ onExportMarkdown: vi.fn(), history: { article: [], all: [] } }}
      />,
    )
    expect(screen.getByText(/本篇还没有记录/)).toBeTruthy()
  })

  it('本句仿写下方有「语言点造句」：多选、按序号出输入框、中英开关、批改框默认展开', () => {
    const api = drillApi({ phase: 'imitation', currentSentence: { id: 's1', text: 'We keep up with the news.' } })
    const sentenceImitation = fakeImitation({
      current: {
        id: 'exam:s1',
        sentenceId: 's1',
        task: '用学过的句型仿写一句英文',
        model: 'We keep up with the news.',
        mustUse: ['keep up with'],
        rubric: [],
        source: 'local',
      },
    })
    const toggle = vi.fn()
    const langPoint = {
      choices: [
        { en: 'keep up with', zh: '跟上', done: false },
        { en: 'the news', zh: '新闻', done: true },
        { en: 'the economy', zh: '经济', done: false },
      ],
      selected: ['keep up with', 'the news'],
      toggle,
      sentence: { id: 's1', text: 'We keep up with the news.' },
      articleId: 'a1',
      articleTitle: 'A',
      setWritingHistory: vi.fn(),
      writingHistory: [],
      flash: vi.fn(),
      recordActivity: vi.fn(),
    }
    render(
      <GoldenPanel
        api={api}
        articleTitle="A"
        onSpeak={vi.fn()}
        actions={{ onExportMarkdown: vi.fn(), sentenceImitation, langPoint }}
      />,
    )
    expect(screen.getByText('还是单独练语言点？')).toBeTruthy()
    // 多选块：选中态带 on 类（有底色），没选的不带；练过的带 ✓
    expect(screen.getByRole('button', { name: /keep up with — 跟上/ }).className).toContain('on')
    expect(screen.getByRole('button', { name: /the economy — 经济/ }).className).not.toContain('on')
    expect(screen.getByRole('button', { name: /keep up with — 跟上/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /the news — 新闻 ✓/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /the news/ }))
    expect(toggle).toHaveBeenCalledWith('the news')

    // 勾了几个就出几个编号框，各自一道题
    expect(screen.getByText('①')).toBeTruthy()
    expect(screen.getByText('②')).toBeTruthy()
    expect(screen.getByText(/用「keep up with」（跟上）写一句英文/)).toBeTruthy()
    expect(screen.getByText(/用「the news」（新闻）写一句英文/)).toBeTruthy()

    // 中 / EN 开关：关掉后不再显示释义，并写进 localStorage
    fireEvent.click(screen.getByRole('button', { name: '中 / EN' }))
    expect(screen.queryByRole('button', { name: /keep up with — 跟上/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'keep up with' })).toBeTruthy()
    expect(localStorage.getItem('reader:goldenLangZh')).toBe('false')

    // AI 结果框：单句仿写默认展开；语言点多题时收起，避免一屏全是粘贴框
    const boxes = document.querySelectorAll('details.golden-exam-paste')
    expect(boxes.length).toBe(3)
    expect((boxes[0] as HTMLDetailsElement).open).toBe(true)
    expect((boxes[1] as HTMLDetailsElement).open).toBe(false)
    expect((boxes[2] as HTMLDetailsElement).open).toBe(false)
  })

  it('顶栏「上一句 / 下一句」箭头：能回看已完成的句子', () => {
    const api = drillApi({
      phase: 'preview',
      index: 1,
      ordered: [{ id: 's1' }, { id: 's2' }],
    })
    render(<GoldenPanel api={api} articleTitle="A" onSpeak={vi.fn()} actions={{ onExportMarkdown: vi.fn() }} />)
    fireEvent.click(screen.getByRole('button', { name: /上一句/ }))
    expect(api.prevSentence).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /下一句/ }))
    expect(api.nextSentence).toHaveBeenCalled()
  })

  it('纯图标播放按钮有可访问名，不靠 emoji 当标签', () => {
    render(<GoldenPanel api={drillApi()} articleTitle="A" onSpeak={vi.fn()} actions={{ onExportMarkdown: vi.fn() }} />)
    expect(screen.getByRole('button', { name: '播放整句' })).toBeTruthy()
  })

  it('预览阶段的功能条和文本区在同一个吸顶容器里', () => {
    const { container } = render(
      <GoldenPanel
        api={drillApi({ phase: 'preview' })}
        articleTitle="A"
        onSpeak={vi.fn()}
        actions={{ onExportMarkdown: vi.fn() }}
      />,
    )
    const top = container.querySelector('.golden-top')
    expect(top?.querySelector('.golden-drill-bar')).toBeTruthy()
    expect(top?.querySelector('.golden-preview')).toBeTruthy()
  })

  it('填空本组正确后检查按钮禁用，Enter 留给继续下一组', () => {
    const api = drillApi({ fillRoundPassed: true })
    render(<GoldenPanel api={api} articleTitle="A" onSpeak={vi.fn()} actions={{ onExportMarkdown: vi.fn() }} />)
    const check = screen.getByRole('button', { name: /检查/ }) as HTMLButtonElement
    expect(check.disabled).toBe(true)
    expect(screen.getByRole('button', { name: /本组正确/ })).toBeTruthy()
  })

  it('每组填空开始时自动聚焦第一个空', async () => {
    const api = drillApi()
    const { rerender } = render(
      <GoldenPanel api={api} articleTitle="A" onSpeak={vi.fn()} actions={{ onExportMarkdown: vi.fn() }} />,
    )
    await waitFor(() => expect(document.activeElement).toBe(screen.getAllByRole('textbox')[0]))

    const next = { ...api, cloze: {
      sentence: 'We keep up with the news.',
      parts: [
        { text: 'We keep ', blank: false },
        { text: 'up', blank: true, targetIndex: 0, blankIndex: 1 },
        { text: ' ', blank: false },
        { text: 'with', blank: true, targetIndex: 0, blankIndex: 2 },
        { text: ' the news.', blank: false },
      ],
      blanks: [
        { index: 1, targetIndex: 0, wordIndex: 1, answer: 'up', hint: '跟上', kind: 'idiom' },
        { index: 2, targetIndex: 0, wordIndex: 2, answer: 'with', kind: 'idiom' },
      ],
      targets: [{ en: 'keep up with', zh: '跟上', kind: 'idiom' }],
    }, fillRound: 1 } as unknown as ReturnType<typeof useGoldenDrill>
    rerender(
      <GoldenPanel api={next} articleTitle="A" onSpeak={vi.fn()} actions={{ onExportMarkdown: vi.fn() }} />,
    )
    await waitFor(() => expect(document.activeElement).toBe(screen.getAllByRole('textbox')[0]))
  })

  it('本句小结后先进入单句仿写', () => {
    const setPhase = vi.fn()
    const api = drillApi({ phase: 'summary', setPhase })
    render(
      <GoldenPanel
        api={api}
        articleTitle="A"
        onSpeak={vi.fn()}
        actions={{ onExportMarkdown: vi.fn(), sentenceImitation: fakeImitation() }}
      />,
    )
    fireEvent.click(screen.getByText('开始本句仿写'))
    expect(setPhase).toHaveBeenCalledWith('imitation')
  })

  it('单句仿写没写答案不能进入下一句', () => {
    const api = drillApi({ phase: 'imitation' })
    const imitation = fakeImitation({
      current: {
        id: 'exam:s1',
        sentenceId: 's1',
        task: '换一个场景，用 In response to 写一句。',
        model: 'We keep up with the news.',
        mustUse: ['in response to'],
        rubric: [],
        source: 'local',
      },
    })
    render(
      <GoldenPanel
        api={api}
        articleTitle="A"
        onSpeak={vi.fn()}
        actions={{ onExportMarkdown: vi.fn(), sentenceImitation: imitation }}
      />,
    )
    expect(screen.getByText('换一个场景，用 In response to 写一句。')).toBeTruthy()
    expect((screen.getByRole('button', { name: '进入逆向回顾' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
