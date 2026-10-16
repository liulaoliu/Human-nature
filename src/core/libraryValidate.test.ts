import { describe, it, expect } from 'vitest'
import { libraryErrors, validateLibrary } from './libraryValidate'
import { createLibrary, markWord } from './vocab'
import { TEST_NOW, vocabItem } from './testFixtures'

/**
 * 词库不变量校验：数据是唯一资产，这里负责在「导入的 JSON / 手改过的库 / 老版本残留」
 * 进来时把结构问题指出来（error 必须在迁移时被修掉）。
 */
describe('validateLibrary：error', () => {
  it('正常库（含 markWord 产物）没有 error', () => {
    const lib = markWord(createLibrary(), { word: 'run', articleId: 'A' }, TEST_NOW).library
    expect(libraryErrors(lib)).toEqual([])
  })

  it('抓：lemma 重复 / status 非法 / 时间不是 ISO / reviewState 坏', () => {
    const bad = {
      schemaVersion: 1,
      items: [
        vocabItem({ id: 'vocab:run', word: 'run', lemma: 'run' }),
        vocabItem({ id: 'vocab:run2', word: 'running', lemma: 'run' }), // lemma 重复
        vocabItem({ id: 'vocab:x', word: 'x', lemma: 'x', status: 'nope' as never }),
        vocabItem({ id: 'vocab:y', word: 'y', lemma: 'y', createdAt: '昨天' }),
        vocabItem({ id: 'vocab:z', word: 'z', lemma: 'z', reviewState: {} as never }),
      ],
    }
    const msgs = libraryErrors(bad).map((i) => i.message).join(' | ')
    expect(msgs).toContain('lemma 重复')
    expect(msgs).toContain('status 非法')
    expect(msgs).toContain('createdAt')
    expect(msgs).toContain('reviewState')
  })

  it('非对象 / items 不是数组 → 全灭但不炸', () => {
    expect(libraryErrors(null).length).toBeGreaterThan(0)
    expect(libraryErrors({ schemaVersion: 1, items: 'nope' }).map((i) => i.message)).toContain('items 不是数组')
  })
})

describe('validateLibrary：warn', () => {
  it('id 与 lemma 不一致 / 例句缺 text → 只 warn，不算致命', () => {
    const issues = validateLibrary({
      schemaVersion: 1,
      items: [vocabItem({ id: 'vocab:old-name', word: 'run', lemma: 'run', examples: [{ text: '  ' }] })],
    })
    expect(issues.every((i) => i.level === 'warn')).toBe(true)
    expect(issues.map((i) => i.message).join(' | ')).toContain('id 与 lemma 不一致')
  })
})
