import { describe, expect, it } from 'vitest'
import { applyTableTask, missingWords, type ApplyTableTask } from './aiApply'
import { createLibrary } from './vocab'
import type { VocabItem, VocabLibrary } from '../types/document'

const NOW = '2026-10-19T00:00:00.000Z'

function item(word: string, lemma = word, partOfSpeech = 'v.'): VocabItem {
  return {
    id: `vocab:${lemma}`,
    word,
    lemma,
    phonetic: null,
    partOfSpeech,
    meaning: '跑',
    usage: [],
    examples: [],
    source: null,
    status: 'queried',
    note: '',
    tags: [],
    reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function libOf(...names: string[]): VocabLibrary {
  return { ...createLibrary(), items: names.map((n) => item(n)) }
}

const first = (lib: VocabLibrary, lemma: string) => lib.items.find((it) => it.lemma === lemma)!

describe('missingWords：按 lemma 比，不按字面', () => {
  it('running 算 returned 里的 run', () => {
    expect(missingWords(['run', 'adapts'], ['running'])).toEqual(['adapts'])
  })

  it('全没返回 → 原样返回请求列表', () => {
    expect(missingWords(['a', 'b'], [])).toEqual(['a', 'b'])
  })
})

describe('applyTableTask：解析不出来就 ok=false，且不落库', () => {
  const table: { task: ApplyTableTask; raw: string }[] = [
    { task: 'confusable', raw: '随便写点' },
    { task: 'example', raw: '随便写点' },
    { task: 'phrase', raw: '随便写点' },
    { task: 'grammar_mark', raw: '随便写点' },
    { task: 'lemma', raw: '随便写点' },
    { task: 'pos', raw: '随便写点' },
  ]

  it.each(table)('$task：坏格式', ({ task, raw }) => {
    const out = applyTableTask(task, raw, libOf('run'), ['run'])
    expect(out.ok).toBe(false)
    expect(out.next).toBe(null)
    expect(out.report[0]).toContain('没解析出')
  })
})

describe('applyTableTask：confusable', () => {
  it('写到对应词条，回执给数量', () => {
    const out = applyTableTask('confusable', 'run | adopt:采用 ; sprint:冲刺', libOf('run'), ['run'])
    expect(out.ok).toBe(true)
    expect(out.next).not.toBe(null)
    expect(first(out.next!, 'run').confusables).toHaveLength(2)
    expect(first(out.next!, 'run').confusablesSource).toBe('ai')
    expect(out.report[0]).toBe('成功写入 1 个词的混淆项')
    expect(out.missing).toBe(null)
  })

  it('自己当自己的易混词 → 内容无效（running 会归一到 run）', () => {
    const out = applyTableTask('confusable', 'run | running:跑步', libOf('run'), ['run'])
    expect(out.next).toBe(null)
    expect(out.report.join(' ')).toContain('内容无效 1 个')
  })

  it('词库里没有的词 / 内容无效：分开报，不写库', () => {
    // 一行一个词：解析器按行切
    const out = applyTableTask('confusable', 'zzz | aa:aa\ngone | gone:自己', libOf('run'), ['zzz'])
    expect(out.next).toBe(null) // 一条能写的都没有 → 不该 persist
    const text = out.report.join(' ')
    expect(text).toContain('词库里没有 1 个')
    expect(text).toContain('内容无效 1 个')
    expect(out.missing).toBe(null)
  })
})

describe('applyTableTask：补内容类（example / phrase / grammar_mark）', () => {
  it('example：例句落进词条', () => {
    const out = applyTableTask('example', 'run | I run daily. | 我每天跑。', libOf('run'), ['run'])
    expect(out.report[0]).toBe('解析 1 行，实际写入 1 个词的例句')
    expect(first(out.next!, 'run').examples[0].text).toBe('I run daily.')
  })

  it('example：一行都对不上词库时不说「已加入」，且不落库', () => {
    // 旧回执照 `rows.length` 说「已加入 1 个词的例句」，卡上其实是空的
    const out = applyTableTask('example', 'zebra | A zebra runs. | 斑马在跑。', libOf('run'), ['run'])
    expect(out.next).toBe(null)
    expect(out.report[0]).toBe('解析 1 行，实际写入 0 个词的例句')
    expect(out.report[1]).toContain('zebra')
  })

  it('phrase：词组进 phrases，AI 漏的进 missing', () => {
    const out = applyTableTask('phrase', 'run | run out — 用完 | run in the family', libOf('run', 'walk'), [
      'run',
      'walk',
    ])
    expect(first(out.next!, 'run').phrases?.some((p) => p.startsWith('run out'))).toBe(true)
    expect(out.missing).toEqual({ task: 'phrase', words: ['walk'] })
  })

  it('grammar_mark：按词性过滤，只留词性相关的标记', () => {
    const out = applyTableTask('grammar_mark', 'run | 及物；不及物', libOf('run'), ['run'])
    expect(first(out.next!, 'run').grammarMarks).toContain('不及物')
    expect(out.report[0]).toBe('已标注 1 个词的语法标记')
  })
})

describe('applyTableTask：改词形类（lemma / pos）', () => {
  it('lemma：校正词形并合并重复', () => {
    const lib: VocabLibrary = { ...createLibrary(), items: [item('running'), item('run')] }
    const out = applyTableTask('lemma', 'running | run', lib, ['running'])
    expect(out.next!.items).toHaveLength(1)
    expect(first(out.next!, 'run').word).toBe('run')
    expect(out.report[0]).toBe('校正 1 个词形（共 1 行）')
    expect(out.report[1]).toBe('合并去重 1 个')
  })

  it('lemma：派生词当原形一律拒绝，并在回执里点名', () => {
    // 真实病例：AI 说 unchallenged 的原形是 challenge，改完 challenge 卡上挂着
    // unchallenged 的释义（a. 未引起争论的）
    const lib: VocabLibrary = { ...createLibrary(), items: [item('unchallenged', 'unchallenged')] }
    const out = applyTableTask('lemma', 'unchallenged | challenge', lib, ['unchallenged'])
    expect(out.next!.items[0].word).toBe('unchallenged')
    expect(out.report[0]).toBe('校正 0 个词形（共 1 行）')
    expect(out.report.some((r) => r.includes('拒绝 1 个「派生词当原形」') && r.includes('unchallenged→challenge'))).toBe(
      true,
    )
  })

  it('pos：辨析写进 note，未覆盖的词进 missing', () => {
    const raw = 'run | running | v. | 谓语动词 | 主语 | 跑 | 主语执行动作 | v.'
    const out = applyTableTask('pos', raw, libOf('running'), ['run'])
    expect(out.report[0]).toBe('已写回 1 条辨析')
    expect(first(out.next!, 'run').note).toContain('[辨析]')
    // 请求的是原形 run，AI 回的是当前形式 running → 按词形比算「未覆盖」
    expect(out.missing).toEqual({ task: 'pos', words: ['run'] })
  })
})
