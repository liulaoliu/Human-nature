import { describe, expect, it } from 'vitest'
import { LEARNING_KEYS } from './learning.ts'
import { LEARNING_SECTION_TABLES } from '../../server/sqliteLearningSections.ts'

/**
 * 学习记录 section 有三处：客户端 key、服务端表映射、服务端数组键校验。
 * 至少把前两处钉在一起：新增 section 漏改服务端时，这个测试会直接红。
 *
 * 为什么在 `src/core/` 而不是 `server/`：服务端程序（tsconfig.server.json，NodeNext）
 * 吃不下 `src/` 的模块（要求显式扩展名、lib 只有 ES2022），而这个断言天生要同时 import 两侧。
 * 客户端程序（moduleResolution: bundler）两边都能读，所以放在这一侧；
 * `server/sqliteLearningSections.ts` 没有任何 import，拉进来不会污染依赖方向。
 */
describe('学习记录 section 清单', () => {
  it('客户端 LEARNING_KEYS 与服务端表映射完全一致', () => {
    expect(Object.keys(LEARNING_SECTION_TABLES).sort()).toEqual(Object.keys(LEARNING_KEYS).sort())
  })
})
