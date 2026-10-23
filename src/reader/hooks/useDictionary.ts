import { useEffect, useState } from 'react'
import { dictionaryReady, loadDictionary } from '../../adapters/dictionary'

/**
 * 空闲时再干重活：首屏先把正文画出来。
 *
 * 词典是 `ecdict.tsv` 7.8MB + 变体 1.1MB + 近似词 0.3MB，解析本身在主线程要几百毫秒；
 * 以前它和正文渲染抢同一帧，表现就是「点开文章，正文迟迟不出来」。
 * `requestIdleCallback` 会等浏览器空闲；没有这个 API（Safari 老版本）就退 300ms。
 */
function whenIdle(fn: () => void): () => void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
    .requestIdleCallback
  if (typeof ric === 'function') {
    const id = ric(fn, { timeout: 3000 })
    return () => (globalThis as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(id)
  }
  const id = setTimeout(fn, 300)
  return () => clearTimeout(id)
}

/** 启动时加载离线词典；返回是否就绪（没有数据文件就一直 false，功能自动降级）。 */
export function useDictionary(): boolean {
  const [ready, setReady] = useState(dictionaryReady())
  useEffect(() => {
    if (ready) return
    let alive = true
    const cancel = whenIdle(() => {
      void loadDictionary().then((ok) => {
        if (alive && ok) setReady(true)
      })
    })
    return () => {
      alive = false
      cancel()
    }
  }, [ready])
  return ready
}
