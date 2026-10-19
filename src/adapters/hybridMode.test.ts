import { describe, expect, it } from 'vitest'
import { HYBRID_RETRY_MS, HybridMode } from './hybridMode'

describe('HybridMode：SQLite 优先，失败退到 local 并定期重试', () => {
  it('探活成功 → 一直走 SQLite，不再重复探活', async () => {
    let probes = 0
    const mode = new HybridMode(async () => {
      probes++
      return true
    })
    expect(await mode.useSqlite()).toBe(true)
    expect(await mode.useSqlite()).toBe(true)
    expect(probes).toBe(1)
  })

  it('探活失败 → local；退避窗口内不再探活，过期后恢复 SQLite', async () => {
    let now = 1_000
    let healthy = false
    let probes = 0
    const mode = new HybridMode(
      async () => {
        probes++
        return healthy
      },
      HYBRID_RETRY_MS,
      () => now,
    )
    expect(await mode.useSqlite()).toBe(false)
    expect(probes).toBe(1)

    now += HYBRID_RETRY_MS - 1
    expect(await mode.useSqlite()).toBe(false)
    expect(probes).toBe(1)

    healthy = true
    now += 2
    expect(await mode.useSqlite()).toBe(true)
    expect(probes).toBe(2)
  })

  it('运行中失败：立即切 local，退避后重新探活（不会永久锁死）', async () => {
    let now = 1_000
    let healthy = true
    let probes = 0
    const mode = new HybridMode(
      async () => {
        probes++
        return healthy
      },
      HYBRID_RETRY_MS,
      () => now,
    )
    expect(await mode.useSqlite()).toBe(true)

    healthy = false
    mode.fail()
    expect(await mode.useSqlite()).toBe(false)
    expect(probes).toBe(1)

    healthy = true
    now += HYBRID_RETRY_MS
    expect(await mode.useSqlite()).toBe(true)
    expect(probes).toBe(2)
  })
})
