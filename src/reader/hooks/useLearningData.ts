import { useMemo } from 'react'
import type { LearningCollections, LearningSetters, UseLearningDataParams } from './learningDataTypes'
import { useLearningActions } from './useLearningActions'
import { useLearningCollections } from './useLearningCollections'
import { useLearningRebuild } from './useLearningRebuild'
import { useReadDone } from './useReadDone'

export type { LearningCollections, LearningSetters, UseLearningDataParams } from './learningDataTypes'

/**
 * 学习记录状态的**唯一收口**：
 * 练习 / 错题 / 活动 / 背词日 / 每日学词 / 题型统计 / 复述 / 选词会话 / 略读 /
 * 读完记录 / 阅读目标 / 目标备忘。
 *
 * 落盘层在 useLearningCollections，写动作在 useLearningActions；这里只做装配，
 * 并把 readDone 并进导出快照 / 合并导入的 setters。
 */
export function useLearningData(params: UseLearningDataParams) {
  const collections = useLearningCollections()
  const { snapshot, setters: collectionSetters, ...fields } = collections
  const readDoneApi = useReadDone(params)

  const data = useMemo<LearningCollections>(
    () => ({ ...snapshot, readDone: readDoneApi.readDone }),
    [snapshot, readDoneApi.readDone],
  )
  const setters = useMemo<LearningSetters>(
    () => ({ ...collectionSetters, setReadDone: readDoneApi.setReadDone }),
    [collectionSetters, readDoneApi.setReadDone],
  )

  /** 重建派生 + 对账：属于学习记录域（读的是这份记录），所以挂在这个收口里，别在视图再开一个。 */
  const rebuild = useLearningRebuild({ flash: params.flash })
  const actions = useLearningActions({ params, studiedDays: fields.studiedDays, setters: collectionSetters })

  return {
    // 扁平字段：界面沿用旧名字，减少一次性改动面
    ...fields,
    ...readDoneApi,
    ...actions,
    // 导出 / 合并导入用
    data,
    setters,
    // 统计页「重建并核对」：服务端用答题事件重算派生，再与本地对账（只读，不写本地）
    rebuild,
  }
}
