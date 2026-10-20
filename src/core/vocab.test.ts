import { describe, it, expect } from 'vitest'
import * as facade from './vocab'
import * as word from './vocab/word'
import * as merge from './vocab/merge'
import * as analysis from './vocab/analysis'
import * as library from './vocab/library'
import * as review from './vocab/review'

/**
 * `core/vocab.ts` 只是对外出口；实现已拆到 `core/vocab/` 五个子模块。
 * 这里守住两件事：子模块的导出都能从 facade 拿到（引用不变），
 * 且跨模块组合的主流程仍能跑通。
 */
describe('vocab facade', () => {
  it('re-export 了所有子模块的运行时导出（同一引用）', () => {
    for (const mod of [word, merge, analysis, library, review]) {
      for (const [name, value] of Object.entries(mod)) {
        expect((facade as Record<string, unknown>)[name], name).toBe(value)
      }
    }
  })

  it('标词 → 粘回查词结果 → 排期 的跨模块流程', () => {
    const now = new Date('2026-10-02T00:00:00.000Z')
    let lib = facade.markWord(facade.createLibrary(), { word: 'running', articleId: 'a1' }, now).library
    lib = facade.applyWordAnalysis(lib, [{ word: 'run', meaning: '跑' }], now)
    lib = facade.reviewItem(lib, lib.items[0].id, 'good', now)
    expect(lib.items[0]).toMatchObject({ lemma: 'run', meaning: '跑', status: 'queried' })
    expect(lib.items[0].reviewState.repetitions).toBe(1)
    expect(facade.buildReviewQueue(lib.items, new Date('2026-10-03T00:00:00.000Z'))).toHaveLength(1)
  })
})
