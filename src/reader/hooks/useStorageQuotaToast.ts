import { useEffect } from 'react'
import { STORAGE_ERROR_EVENT } from './useLocalStorageState'

/**
 * 本机存储写失败（配额满 / 隐私模式）时提示一次。
 *
 * `useLocalStorageState` 捕获写失败后会派发 `STORAGE_ERROR_EVENT`；
 * 没有这个监听，用户会以为「已保存」，刷新才发现丢了。
 * 5 秒节流：一次操作可能连写好几个键，别刷屏。
 */
export function useStorageQuotaToast(flash: (msg: string) => void): void {
  useEffect(() => {
    let last = 0
    const onError = () => {
      const now = Date.now()
      if (now - last < 5000) return
      last = now
      flash('本机存储已满：这次的改动只在本页有效，刷新会丢；请先导出备份')
    }
    window.addEventListener(STORAGE_ERROR_EVENT, onError)
    return () => window.removeEventListener(STORAGE_ERROR_EVENT, onError)
  }, [flash])
}
