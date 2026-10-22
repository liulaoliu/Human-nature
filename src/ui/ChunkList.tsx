import { useEffect, useRef } from 'react'
import type { Chunk } from '../core/ports'
import { fmt } from './AppBits'

/**
 * 左侧块列表，顺带负责「自动滚到当前块」。
 *
 * 两个查找表（每条录音数 / 撕开点）由调用方整篇算一次再传进来：
 * 原来每个 `<li>` 都 filter 一遍全部录音、扫一遍全部撕开点，
 * 一篇 250 块 × 250 条录音就是每帧几万次（录音时电平表按 25fps 触发重渲染）。
 */
export function ChunkList({
  chunks,
  current,
  takeCountByChunk,
  splitTimes,
  onSelect,
}: {
  chunks: Chunk[]
  current: number
  takeCountByChunk: Map<number, number>
  /** 撕开时间点取到 20ms 精度后的集合（`Math.round(t * 50)`） */
  splitTimes: Set<number>
  onSelect: (index: number) => void
}) {
  const listRef = useRef<HTMLOListElement>(null)
  const prevCount = useRef(0)

  useEffect(() => {
    const ol = listRef.current
    // 列表随 body 一起卸载/重挂，换文件时 prevCount 天然归零：
    // 换文件不该被当成「刚撕开了一块」，所以这里不会去滚 current+1
    const grew = prevCount.current > 0 && chunks.length > prevCount.current
    prevCount.current = chunks.length
    if (!ol || ol.children.length === 0) return
    const idx = grew ? Math.min(current + 1, chunks.length - 1) : current
    const el = ol.children[idx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [current, chunks.length])

  return (
    <ol className="list" ref={listRef}>
      {chunks.map((c) => {
        // 计数和 ✂ 都查表：原来每行都 filter 全部录音、扫全部撕开点
        const n = takeCountByChunk.get(c.index) ?? 0
        const cut = splitTimes.has(Math.round(c.start * 50))
        return (
          <li key={c.index}>
            <button
              className={c.index === current ? 'row on' : 'row'}
              onClick={() => onSelect(c.index)}
            >
              <span className="i">{c.index + 1}</span>
              <span className="t">{fmt(c.start)}</span>
              <span className="d">
                {cut && (
                  <span className="cut" title="手动撕开的新边界">
                    ✂
                  </span>
                )}
                {n > 0 ? <b title={`${n} 条录音`}>●{n}</b> : null}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
