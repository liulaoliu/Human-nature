import { useCallback } from 'react'
import {
  DEFAULT_PRODUCTION_SETTINGS,
  normalizeProductionSettings,
  type ProductionSettings,
} from '../../core/production'
import { useLocalStorageState } from './useLocalStorageState'

/**
 * 奶牛工棚的开始设置：主题 / 范围 / 类型 / 题数 / 薄弱比例。
 *
 * 这些是**偏好**，不是学习记录：丢了重设即可，所以放 localStorage；
 * 每次作答的正文 / 反馈仍写 `writingHistory`，走 SQLite 学习记录同步。
 */
export const PRODUCTION_SETTINGS_KEY = 'reader:productionSettings'

const persistentProductionSettings = {
  parse: (raw: string): ProductionSettings => {
    try {
      return normalizeProductionSettings(JSON.parse(raw))
    } catch {
      return { ...DEFAULT_PRODUCTION_SETTINGS, types: [...DEFAULT_PRODUCTION_SETTINGS.types] }
    }
  },
  serialize: (value: ProductionSettings) => JSON.stringify(value),
}

export function useProductionSettings() {
  const [settings, setSettings] = useLocalStorageState<ProductionSettings>(
    PRODUCTION_SETTINGS_KEY,
    { ...DEFAULT_PRODUCTION_SETTINGS, types: [...DEFAULT_PRODUCTION_SETTINGS.types] },
    persistentProductionSettings,
  )

  const update = useCallback(
    (patch: Partial<ProductionSettings>) => {
      setSettings((prev) => normalizeProductionSettings({ ...prev, ...patch }))
    },
    [setSettings],
  )

  return { settings, update }
}
