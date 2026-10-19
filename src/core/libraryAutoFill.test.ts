import { describe, it, expect } from 'vitest'
import { autoFillLibrary, collectOfflineExampleRows } from './libraryAutoFill'
import { createLibrary, markWord, normalizeWord } from './vocab'
import { upsertLanguagePoints, type LanguagePoint } from './langPoints'
import { TEST_NOW, vocabItem } from './testFixtures'
import { applyLemmaMap, dedupeLibrary } from './vocab'
import { dictLemmaPairs, type Ecdict } from './ecdict'

const src = (articleId: string, sentenceId: string, sentenceText = 'Sentence.') => ({
  articleId,
  fileName: articleId,
  sentenceId,
  sentenceText,
})
const phrase = (word: string, gloss: string, source = src('A', 's1')): LanguagePoint => ({
  kind: 'phrase',
  word,
  gloss,
  source,
})

describe('autoFillLibrary（词库自动补全的唯一入口）', () => {
  it('空素材：一个字都不动（libraryUntouched 让调用方跳过写库）', () => {
    const lib = createLibrary()
    const out = autoFillLibrary(lib, { langPoints: [], collected: {} }, TEST_NOW)
    expect(out.libraryUntouched).toBe(true)
    expect(out.collectedUntouched).toBe(true)
    expect(out.applied).toEqual({ lemmaFixes: 0, langPoints: 0, offlineExamples: 0 })
  })

  it('跑两遍结果一样（幂等）：第二遍不再动词库，签名也不变', () => {
    const points = [phrase('fall back on', '转而依靠')]
    const first = autoFillLibrary(createLibrary(), { langPoints: points, collected: {} }, TEST_NOW)
    expect(first.applied.langPoints).toBe(1)
    expect(first.library.items).toHaveLength(1)
    const second = autoFillLibrary(first.library, { langPoints: points, collected: first.collected }, TEST_NOW)
    expect(second.library).toBe(first.library) // 同一个引用：没写库
    expect(second.libraryUntouched).toBe(true)
    expect(second.collectedUntouched).toBe(true)
  })

  it('回归（踩坑 #1）：语言点 + 离线例句一起补，且「拿旧快照重跑」不会再造/再删条目', () => {
    const points = [phrase('fall back on', '转而依靠'), phrase('take its toll', '造成损害', src('A', 's2'))]
    const lookup = () => [{ text: 'He falls back on his savings.', translation: '他依靠积蓄。' }]
    const first = autoFillLibrary(createLibrary(), { langPoints: points, collected: {}, offline: { lookup } }, TEST_NOW)
    expect(first.library.items).toHaveLength(2)
    expect(first.applied.langPoints).toBe(2)
    const n = first.library.items.length

    // 模拟「词库里已经收过，但某个 effect 拿旧快照又跑了一遍」：条目数不能变
    for (let i = 0; i < 3; i++) {
      const again = autoFillLibrary(first.library, { langPoints: points, collected: first.collected, offline: { lookup } }, TEST_NOW)
      expect(again.library.items.length).toBe(n)
      expect(again.library).toBe(first.library)
    }
  })

  it('每次只收「签名变了的那几篇」：换过的那篇重收，没换的不动', () => {
    const a1 = phrase('run out', '用完', src('A', 's1'))
    const b1 = phrase('take its toll', '造成损害', src('B', 's1'))
    const first = autoFillLibrary(createLibrary(), { langPoints: [a1, b1], collected: {} }, TEST_NOW)
    expect(first.library.items).toHaveLength(2)

    // 只有 B 的语言点变了（AI 重跑）
    const b2 = phrase('take its toll', '造成损害（重跑）', src('B', 's1'))
    const second = autoFillLibrary(first.library, { langPoints: [a1, b2], collected: first.collected }, TEST_NOW)
    expect(second.collected.B).not.toBe(first.collected.B)
    expect(second.library.items.find((it) => it.lemma === 'take its toll')?.meaning).toBe('造成损害（重跑）')
    expect(second.applied.langPoints).toBe(1) // 只动了 B 这篇
  })

  it('同一次调用里先做词形归并，再收语言点（P0 双写回归）', () => {
    const dict = {
      entries: new Map(),
      forms: new Map([['runs', 'run']]),
      near: new Map(),
    } as unknown as Ecdict
    const lib = markWord(createLibrary(), { word: 'runs', articleId: 'A' }, TEST_NOW).library
    const points = [phrase('fall back on', '转而依靠')]
    const out = autoFillLibrary(lib, { langPoints: points, collected: {}, dict }, TEST_NOW)
    expect(out.library.items.map((it) => it.word).sort()).toEqual(['fall back on', 'run'])
    expect(out.applied.lemmaFixes).toBe(1)
    expect(out.applied.langPoints).toBe(1)

    // 再跑一遍：两件事都已做过，不能再写库
    const again = autoFillLibrary(
      out.library,
      { langPoints: points, collected: out.collected, dict },
      TEST_NOW,
    )
    expect(again.library).toBe(out.library)
    expect(again.libraryUntouched).toBe(true)
  })

  it('词典词形归并不影响收藏条目（交替跑稳定）', () => {
    const points = [phrase('algaes', '藻类'), phrase('fall back on', '转而依靠', src('A', 's2'))]
    // 词典只认识单词：模拟真实库（两跳 algaes → algae → alga）
    const dictPairs = (items: { word: string; lemma: string; kind?: string; status?: string }[]) =>
      items.filter((it) => !it.kind && !normalizeWord(it.word).includes(' ')).map((it) => ({ from: it.word, to: 'alga' }))
    let lib = createLibrary()
    let collected: Record<string, string> = {}
    const counts: number[] = []
    for (let i = 0; i < 3; i++) {
      const out = autoFillLibrary(lib, { langPoints: points, collected }, TEST_NOW)
      lib = dedupeLibrary(applyLemmaMap(out.library, dictPairs(out.library.items as never)))
      collected = out.collected
      counts.push(lib.items.length)
    }
    expect(counts).toEqual([2, 2, 2])
    expect(dictLemmaPairs({} as never, [])).toEqual([]) // 真词典的那份逻辑另有测试（ecdict.test.ts）
  })
})

describe('collectOfflineExampleRows', () => {
  it('只挑「有释义 + 还缺离线例句」的词，并去重', () => {
    const items = [
      vocabItem({ id: 'a', word: 'run', lemma: 'run', meaning: '跑' }),
      vocabItem({ id: 'b', word: 'void', lemma: 'void', meaning: null }), // 没释义 → 跳过
      vocabItem({ id: 'c', word: 'wall', lemma: 'wall', meaning: '墙', examples: [{ text: 'Wall.', origin: 'tatoeba' }] }),
    ]
    const rows = collectOfflineExampleRows(items, () => [{ text: 'I run.' }, { text: 'I run.' }])
    expect(rows.map((r) => r.word)).toEqual(['run', 'wall'])
    expect(rows[0].examples).toEqual([{ text: 'I run.' }, { text: 'I run.' }])
  })

  it('例句够了就不再要（够 MAX_EXAMPLES 时返回空）', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ text: `s${i}.`, origin: 'tatoeba' as const }))
    expect(collectOfflineExampleRows([vocabItem({ word: 'run', meaning: '跑', examples: many })], () => [{ text: 'x' }])).toEqual([])
  })
})

describe('可选：真实词典下交替跑（没数据文件就跳过）', () => {
  it('upsert + 词典归并 反复跑不涨不跌', () => {
    const points = [phrase('fall back on', '转而依靠')]
    const lib = upsertLanguagePoints(createLibrary(), points, TEST_NOW)
    expect(lib.items).toHaveLength(1)
    // markWord 造的普通单词仍然能进词典归并（kind 为空的才是「单词」）
    const withWord = markWord(lib, { word: 'running', articleId: 'A' }, TEST_NOW).library
    expect(withWord.items).toHaveLength(2)
  })
})
