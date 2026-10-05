import { describe, it, expect } from 'vitest'
import { dictLemmaOf, isAboveLevel, parseEcdict, pickAboveLevelWords, resolveWord } from './ecdict'

// 构造与构建脚本一致的 TSV（\t 分隔；\n 表示换行由脚本转义为 \\n）
const wordsTsv = [
  'word\tphonetic\tpos\ten\tzh\ttag\tcollins\toxford\tbnc\tfrq',
  "allow\tә'lau\t\tv. let have\\nv. permit\tt. 允许\\nvi. 容许\tzk gk cet4 ky\t5\t1\t257\t339",
  'run\t\t\tv. move fast\tn. 跑\tcet4\t5\t1\t100\t100',
  'hobble\t\'hɒbl\t\tvt. prevent\tt. 阻碍\tky\t2\t0\t5000\t6000',
  'carbonfibre\t\t\t\t\tgre\t0\t0\t0\t0',
].join('\n')

const formsTsv = ['running\trun', 'hobbled\thobble'].join('\n')

const dict = parseEcdict(wordsTsv, formsTsv)

describe('parseEcdict / resolveWord / dictLemmaOf', () => {
  it('解析词条并还原转义换行', () => {
    const e = dict.entries.get('allow')
    expect(e?.phonetic).toBe("ә'lau")
    expect(e?.en).toContain('v. let have\nv. permit')
    expect(e?.tag).toBe('zk gk cet4 ky')
  })
  it('按词形还原原形再取词条', () => {
    const hit = resolveWord(dict, 'running')
    expect(hit?.lemma).toBe('run')
    expect(hit?.entry.word).toBe('run')
  })
  it('dictLemmaOf：还原 / 命中 / 查不到', () => {
    expect(dictLemmaOf(dict, 'hobbled')).toBe('hobble')
    expect(dictLemmaOf(dict, 'hobble')).toBe('hobble')
    expect(dictLemmaOf(dict, 'zzzz')).toBeNull()
  })
})

describe('isAboveLevel / pickAboveLevelWords', () => {
  it('四级以内不算超纲，超四级算', () => {
    expect(isAboveLevel(dict, 'allow', 'cet4')).toBe(false) // 含 cet4
    expect(isAboveLevel(dict, 'hobble', 'cet4')).toBe(true) // ky，超四级
    expect(isAboveLevel(dict, 'run', 'cet4')).toBe(false)
  })
  it('从正文按水平挑词（原形、去重、按出现顺序）', () => {
    const text = 'They allow running and hobble the plan, hobbled again.'
    expect(pickAboveLevelWords(dict, text, 'cet4')).toEqual(['hobble'])
  })
  it('词典没有的词不挑', () => {
    expect(pickAboveLevelWords(dict, 'zzzz qqqq', 'cet4')).toEqual([])
  })
})
