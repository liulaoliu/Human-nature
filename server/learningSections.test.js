import { describe, expect, it } from 'vitest'
import { LEARNING_KEYS } from '../src/core/learning.ts'
import { LEARNING_SECTION_TABLES } from './sqliteLearningSections.ts'

/**
 * 学习记录 section 有三处：客户端 key、服务端表映射、服务端数组键校验。
 * 至少把前两处钉在一起：新增 section 漏改服务端时，这个测试会直接红。
 */
describe('学习记录 section 清单', () => {
  it('客户端 LEARNING_KEYS 与服务端表映射完全一致', () => {
    expect(Object.keys(LEARNING_SECTION_TABLES).sort()).toEqual(Object.keys(LEARNING_KEYS).sort())
  })
})
