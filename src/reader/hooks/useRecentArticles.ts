import { useEffect, useRef, useState } from 'react'
import { pushRecentRef } from '../../core/recentArticles'
import { readRecentArticles, saveRecentArticles } from '../../state/recentArticles'

/**
 * 记录「最近打开」：当前文章 ref 一变就把它放到最前。
 *
 * 只记录、不删档：文章被删除后由选择器按当前目录过滤掉，旧 ref 留在本机没有副作用。
 */
export function useRecentArticles(currentRef: string): string[] {
  const [refs, setRefs] = useState<string[]>(readRecentArticles)
  const refsRef = useRef(refs)
  refsRef.current = refs

  useEffect(() => {
    if (!currentRef) return
    const next = pushRecentRef(refsRef.current, currentRef)
    const same = next.length === refsRef.current.length && next.every((x, i) => x === refsRef.current[i])
    if (same) return
    refsRef.current = next
    setRefs(next)
    saveRecentArticles(next)
  }, [currentRef])

  return refs
}
