import { useEffect, useState } from 'react'
import { dictionaryReady, loadDictionary } from '../dictionary'

/** 启动时加载离线词典；返回是否就绪（没有数据文件就一直 false，功能自动降级）。 */
export function useDictionary(): boolean {
  const [ready, setReady] = useState(dictionaryReady())
  useEffect(() => {
    if (ready) return
    let alive = true
    void loadDictionary().then((ok) => {
      if (alive && ok) setReady(true)
    })
    return () => {
      alive = false
    }
  }, [ready])
  return ready
}
