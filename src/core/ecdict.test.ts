import { describe, it, expect } from 'vitest'
import { dictLemmaOf, dictLemmaPairs, glossForPos, isAboveLevel, isDictWord, levelVerdict, parseEcdict, pickAboveLevelWords, resolveWord } from './ecdict'
import { applyLemmaMap, createLibrary, dedupeLibrary } from './vocab'
import { upsertLanguagePoints } from './langPoints'

// 构造与构建脚本一致的 TSV（\t 分隔；\n 表示换行由脚本转义为 \\n）
const wordsTsv = [
  'word\tphonetic\tpos\ten\tzh\ttag\tcollins\toxford\tbnc\tfrq',
  "allow\tә'lau\t\tv. let have\\nv. permit\tt. 允许\\nvi. 容许\tzk gk cet4 ky\t5\t1\t257\t339",
  'run\t\t\tv. move fast\tn. 跑\tcet4\t5\t1\t100\t100',
  'hobble\t\'hɒbl\t\tvt. prevent\tt. 阻碍\tky\t2\t0\t5000\t6000',
  'carbonfibre\t\t\t\t\tgre\t0\t0\t0\t0',
  'bnconly\t\t\t\t\t\t0\t0\t0\t0',
  'fall back on\t\t\tphr. rely on\tt. 转而依靠\t\t0\t0\t0\t0',
  'alga\t\t\tn. seaweed\t n. 藻类\t\t0\t0\t0\t0',
  'algae\t\t\tn. seaweed\t n. 藻类（复数）\t\t0\t0\t0\t0',
].join('\n')

const formsTsv = [
  'running\trun',
  'hobbled\thobble',
  'ensconced\tensconce',
  'falls back on\tfall back on',
  // 两跳：algaes → algae → alga（真实词典里就有 1224 个这种两跳词形）
  'algaes\talgae',
  'algae\talga',
].join('\n')

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
    // 启发式会错成 ensconc 的，词典能给对的（加载时会据此自动纠正）
    expect(dictLemmaOf(dict, 'ensconced')).toBe('ensconce')
  })
})

describe('glossForPos：释义按词性挑行', () => {
  const zh = 'n. 誓约, 誓言\\nvi. 起誓, 发誓\\nvt. 立誓, 起誓要'

  it('动词词性挑动词那条（不是永远取第一行）', () => {
    expect(glossForPos(zh, 'v.')).toBe('vi. 起誓, 发誓')
    expect(glossForPos(zh, 'verb')).toBe('vi. 起誓, 发誓')
    expect(glossForPos(zh, 'vt.')).toBe('vi. 起誓, 发誓')
  })

  it('名词词性挑名词那条', () => {
    expect(glossForPos(zh, 'n.')).toBe('n. 誓约, 誓言')
  })

  it('挑不到 / 没有词性 → 退回第一行', () => {
    expect(glossForPos(zh, 'adj.')).toBe('n. 誓约, 誓言')
    expect(glossForPos(zh, '')).toBe('n. 誓约, 誓言')
  })

  it('空释义返回空串', () => {
    expect(glossForPos('', 'v.')).toBe('')
  })
})

describe('isDictWord / dictLemmaPairs（词形归并只碰单个单词）', () => {
  it('只认单个英文单词：词组 / 习语 / 用法笔记都不算', () => {
    expect(isDictWord({ word: 'running' })).toBe(true)
    expect(isDictWord({ word: 'falls back on' })).toBe(false) // 含空格 = 词组
    expect(isDictWord({ word: 'fall back on', kind: 'phrase' })).toBe(false)
    expect(isDictWord({ word: 'take its toll', kind: 'idiom' })).toBe(false)
    expect(isDictWord({ word: '注意 subject to 是形容词', kind: 'usage' })).toBe(false) // 中文笔记
    expect(isDictWord({ word: '『』' })).toBe(false) // 归一化后为空
  })

  it('词组不做词形归并（否则会并进单词、被语言点收藏再加回来 → 数量跳动）', () => {
    // 词典里确实有 falls back on → fall back on 的映射
    expect(dictLemmaOf(dict, 'falls back on')).toBe('fall back on')
    const pairs = dictLemmaPairs(
      dict,
      [
        { word: 'falls back on', lemma: 'falls back on' }, // 词组（含空格）
        { word: 'running', lemma: 'running' }, // 单词 → 该归并
        { word: 'hobbled', lemma: 'hobbled', status: 'edited' }, // 手动改过：skipLocked 时不动
      ],
      { skipLocked: true },
    )
    expect(pairs).toEqual([{ from: 'running', to: 'run' }])
    expect(dictLemmaPairs(dict, [{ word: 'hobbled', lemma: 'hobbled', status: 'edited' }], { skipLocked: true })).toEqual([])
    expect(dictLemmaPairs(dict, [{ word: 'hobbled', lemma: 'hobbled' }])).toEqual([{ from: 'hobbled', to: 'hobble' }])
  })

  it('语言点收藏 + 词典归并交替跑：词库稳定（修「生词数量在 7694/7696 之间跳」）', () => {
    const source = { articleId: 'A', fileName: 'A', sentenceId: 's1', sentenceText: 'He falls back on it.' }
    const points = [{ kind: 'phrase' as const, word: 'falls back on', gloss: '转而依靠', source }]
    let lib = upsertLanguagePoints(createLibrary(), points)
    const n = lib.items.length
    expect(n).toBe(1)
    // 交替跑三轮：收藏一次 → 词典归并一次；数量必须稳定、且不重复写库
    for (let i = 0; i < 3; i++) {
      const before = lib
      lib = upsertLanguagePoints(lib, points)
      if (i > 0) expect(lib).toBe(before) // 幂等：不再新增
      lib = dedupeLibrary(applyLemmaMap(lib, dictLemmaPairs(dict, lib.items, { skipLocked: true })))
      expect(lib.items.length).toBe(n)
      expect(lib.items[0].word).toBe('falls back on')
    }
  })

  it('词典里的「两跳」词形也不会把收藏的条目翻来覆去（真实数据里 1224 个这种词）', () => {
    // algaes → algae → alga：老写法每轮会把条目的 lemma 改成 alga，
    // 而收藏这边按 lemmaOf('algaes') = 'algae' 找 → 找不到就再建一条，来回跳。
    expect(dictLemmaOf(dict, 'algaes')).toBe('algae')
    expect(dictLemmaOf(dict, 'algae')).toBe('alga')
    const source = { articleId: 'A', fileName: 'A', sentenceId: 's1', sentenceText: 'Algaes grow here.' }
    const points = [{ kind: 'phrase' as const, word: 'algaes', gloss: '藻类', source }]
    let lib = upsertLanguagePoints(createLibrary(), points)
    const counts: number[] = []
    for (let i = 0; i < 4; i++) {
      lib = upsertLanguagePoints(lib, points)
      lib = dedupeLibrary(applyLemmaMap(lib, dictLemmaPairs(dict, lib.items, { skipLocked: true })))
      counts.push(lib.items.length)
    }
    expect(counts).toEqual([1, 1, 1, 1]) // 不增不减（词典改写也不影响）
    // 单个单词的条目交给词典归一（algaes → alga，这是想要的）；关键是**没有来回重建**
    expect(lib.items).toHaveLength(1)
    expect(lib.items[0].kind).toBeUndefined()
    expect(lib.items[0].langPointId).toContain('algaes')
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

  it('levelVerdict 区分 超纲/档内/太生僻/未收录', () => {
    expect(levelVerdict(dict, 'hobble', 'cet4')).toBe('above')
    expect(levelVerdict(dict, 'allow', 'cet4')).toBe('within') // 含 cet4
    expect(levelVerdict(dict, 'bnconly', 'cet4')).toBe('rare') // 无标签/无频次（只靠 bnc）→ 太生僻
    expect(levelVerdict(dict, 'unlisted', 'cet4')).toBe('unknown') // 词典没收录
  })

  it('无级别标签的词用词频兜底：超高频基础词不算超纲（修 entirely/john 这类漏标）', () => {
    const d = parseEcdict(
      [
        'word\tphonetic\tpos\ten\tzh\ttag\tcollins\toxford\tbnc\tfrq',
        'entirely\t\t\t\t\t\t3\t1\t1367\t1858', // 无标签，但排名很靠前 → 常见词
        'impeachment\t\t\t\t\t\t0\t0\t26724\t7636', // 无标签，中等频次 → 仍算超纲
      ].join('\n'),
      '',
    )
    expect(levelVerdict(d, 'entirely', 'cet6')).toBe('within')
    expect(levelVerdict(d, 'impeachment', 'cet6')).toBe('above')
  })

  it('pickAboveLevelWords 跳过句中大写专有名词与全大写缩写', () => {
    const d = parseEcdict(
      [
        'word\tphonetic\tpos\ten\tzh\ttag\tcollins\toxford\tbnc\tfrq',
        'trump\t\t\t\t\tgre\t0\t0\t14687\t12616',
        'hobble\t\t\t\t\tky\t2\t0\t5000\t6000',
        'cia\t\t\t\t\tgre\t0\t0\t1\t1',
      ].join('\n'),
      '',
    )
    // 句首大写的 hobble 收；句中大写的 Trump / 全大写 CIA 跳过
    expect(pickAboveLevelWords(d, 'Hobble the plan with Trump and CIA meddling.', 'cet4')).toEqual(['hobble'])
  })
})
