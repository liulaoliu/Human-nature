import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { dayKeyLocal } from '../../core/activity'

/**
 * 浮层/面板的开关状态（速读 / 今日计划 / 精读工作流 / 学习日志 / 打印导出 / 目标备忘 /
 * 每日统计 / 全部生词）。
 *
 * 为什么单独一个 hook：这 9 个值只有一件事——「哪块浮层盖在正文上」，没有业务含义，
 * 也不参与任何写库。它们原先散落在 ReaderApp 里（隔三差五多一个 `useState`），
 * 把组合根读成了状态清单。收拢之后 ReaderApp 只剩接线，这一组也能单独测。
 *
 * 注意：**打开一个面板不关别的面板**（这是现状，也是设计：今日计划和生词本可以并存）。
 * 要改互斥就在这里改，别散到各个 setter 调用点。
 */
export interface ReaderPanels {
  statsOpen: boolean
  setStatsOpen: Dispatch<SetStateAction<boolean>>
  /** 「全部生词」独立视图（侧栏只显示本篇）。 */
  browseAll: boolean
  setBrowseAll: Dispatch<SetStateAction<boolean>>
  /** 逐句速读。 */
  speedReadOpen: boolean
  setSpeedReadOpen: Dispatch<SetStateAction<boolean>>
  /** 今日计划。 */
  planOpen: boolean
  setPlanOpen: Dispatch<SetStateAction<boolean>>
  /** 精读工作流。 */
  intensiveOpen: boolean
  setIntensiveOpen: Dispatch<SetStateAction<boolean>>
  /** 学习日志 + 选中日期。 */
  journalOpen: boolean
  setJournalOpen: Dispatch<SetStateAction<boolean>>
  journalDay: string
  setJournalDay: Dispatch<SetStateAction<string>>
  /** 打印 / 导出。 */
  exportOpen: boolean
  setExportOpen: Dispatch<SetStateAction<boolean>>
  /** 目标备忘。 */
  goalOpen: boolean
  setGoalOpen: Dispatch<SetStateAction<boolean>>
}

export function useReaderPanels(): ReaderPanels {
  const [statsOpen, setStatsOpen] = useState(false)
  const [browseAll, setBrowseAll] = useState(false)
  const [speedReadOpen, setSpeedReadOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [intensiveOpen, setIntensiveOpen] = useState(false)
  const [journalOpen, setJournalOpen] = useState(false)
  const [journalDay, setJournalDay] = useState(() => dayKeyLocal(new Date()))
  const [exportOpen, setExportOpen] = useState(false)
  const [goalOpen, setGoalOpen] = useState(false)

  // 对象身份只在面板状态真的变化时更新：ReaderApp 下游有一大串 useMemo / memo，
  // 每次渲染都新建这个包会让它们全部失效（P2-4）。
  return useMemo<ReaderPanels>(
    () => ({
      statsOpen,
      setStatsOpen,
      browseAll,
      setBrowseAll,
      speedReadOpen,
      setSpeedReadOpen,
      planOpen,
      setPlanOpen,
      intensiveOpen,
      setIntensiveOpen,
      journalOpen,
      setJournalOpen,
      journalDay,
      setJournalDay,
      exportOpen,
      setExportOpen,
      goalOpen,
      setGoalOpen,
    }),
    [
      statsOpen,
      browseAll,
      speedReadOpen,
      planOpen,
      intensiveOpen,
      journalOpen,
      journalDay,
      exportOpen,
      goalOpen,
    ],
  )
}
