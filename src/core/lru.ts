/**
 * 容量固定的 LRU 缓存。
 *
 * 只用 Map 就够：Map 保插入序，于是「队首 = 最久没用」。
 * 命中时删掉重设一次，它就跑到队尾了；插入后超量就丢队首。
 *
 * 单独抽出来是因为淘汰顺序容易写错，而浏览器适配器那层没有单测。
 */
export class Lru<K, V> {
  private map = new Map<K, V>()

  constructor(private max: number) {
    if (!(max >= 1)) throw new Error('Lru 容量至少是 1')
  }

  get size(): number {
    return this.map.size
  }

  get(key: K): V | undefined {
    const v = this.map.get(key)
    if (v === undefined) return undefined
    this.map.delete(key)
    this.map.set(key, v) // 刷新：变成最新用的
    return v
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next()
      if (oldest.done) break
      this.map.delete(oldest.value)
    }
  }

  clear(): void {
    this.map.clear()
  }
}
