import { describe, expect, it } from 'vitest'
import { toReaderScreenProps, type ReaderAppModel } from './ReaderScreenFromModel'

/** 只钉“分组 → 平铺”的映射；具体视图行为由 ReaderScreen / 宿主测试覆盖。 */
describe('ReaderScreenFromModel：视图接口翻译层', () => {
  it('把分组状态映射回 ReaderScreen 的平铺 props', () => {
    const setComposing = () => {}
    const setListenOpen = () => {}
    const onMouseDown = () => {}
    const app = {
      prefs: {},
      docState: {
        articleTitle: '标题',
        articleKey: 'b:1',
        doc: null,
        selectedId: 's1',
        exact: '',
        useExact: false,
        selSid: 's1',
        selIndices: [0],
      },
      paste: {
        pasted: 'AI 结果',
        setPasted: () => {},
        pasteReport: ['ok'],
        setPasteReport: () => {},
        pasteMissing: null,
        setPasteMissing: () => {},
        lastTask: 'lookup',
      },
      highlight: {
        peekSid: null,
        focusLemma: null,
        setFocusLemma: () => {},
        confirmDel: null,
        setConfirmDel: () => {},
        lastPicked: null,
        bubblePos: null,
      },
      panels: {
        statsOpen: true,
        setStatsOpen: () => {},
        planOpen: true,
        setPlanOpen: () => {},
        browseAll: false,
        setBrowseAll: () => {},
        speedReadOpen: false,
        setSpeedReadOpen: () => {},
        intensiveOpen: false,
        setIntensiveOpen: () => {},
        journalOpen: false,
        setJournalOpen: () => {},
        journalDay: '2026-10-24',
        setJournalDay: () => {},
        exportOpen: false,
        setExportOpen: () => {},
        goalOpen: false,
        setGoalOpen: () => {},
      },
      services: { setListenOpen },
      workspace: { setComposing },
      selection: { onMouseDown },
      articleRouting: { slug: '', indexReady: true, ref: '', currentRef: '' },
    } as unknown as ReaderAppModel

    const props = toReaderScreenProps(app)

    expect(props.articleTitle).toBe('标题')
    expect(props.pasted).toBe('AI 结果')
    expect(props.lastTask).toBe('lookup')
    expect(props.statsOpen).toBe(true)
    expect(props.planOpen).toBe(true)
    expect(props.journalDay).toBe('2026-10-24')
    expect(props.setComposing).toBe(setComposing)
    expect(props.setListenOpen).toBe(setListenOpen)
    expect(props.onMouseDown).toBe(onMouseDown)
  })
})
