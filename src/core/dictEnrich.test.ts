import { describe, it, expect } from 'vitest'
import { enrichWithDict } from './dictEnrich'
import { parseEcdict } from './ecdict'
import { createLibrary, markWord } from './vocab'
import { TEST_NOW, vocabItem } from './testFixtures'

/**
 * 用离线词典补音标/词性/释义（找回词条之后自动跑，所以必须幂等、只补空缺、不联网）。
 */
const dict = parseEcdict(
  [
    'word\tphonetic\tpos\ten\tzh\ttag\tcollins\toxford\tbnc\tfrq',
    'run\trʌn\t\tv. move fast\tv. 跑\tcet4\t5\t1\t100\t100',
    'hobble\t\'hɒbl\t\tvt. prevent\tt. 阻碍\tky\t2\t0\t5000\t6000',
    'ensconce\tɪn\'skɒns\t\tvt. settle comfortably\tv. 使安顿\tgre\t1\t0\t9000\t9000',
  ].join('\n'),
  'ensconced\tensconce',
)

describe('enrichWithDict', () => {
  it('补空着的字段（音标/词性/释义），并把状态推到 queried', () => {
    const lib = markWord(createLibrary(), { word: 'hobble', articleId: 'A' }, TEST_NOW).library
    const out = enrichWithDict(lib, dict, undefined, TEST_NOW)
    const it = out.library.items[0]
    expect(out.filled).toBe(1)
    expect(it.phonetic).toBe("/'hɒbl/")
    expect(it.meaning).toContain('阻碍')
    expect(it.status).toBe('queried')
    expect(it.fieldSources).toEqual({ phonetic: 'dict', meaning: 'dict', definition: 'dict' })
  })

  it('不覆盖已有内容（用户改过/AI 给过的留着）', () => {
    const lib = {
      ...createLibrary(),
      items: [
        vocabItem({ word: 'run', lemma: 'run', phonetic: '/MY/', meaning: '我的释义', definition: 'my own def', status: 'edited' }),
      ],
    }
    const out = enrichWithDict(lib, dict, undefined, TEST_NOW)
    const it = out.library.items[0]
    expect(it.phonetic).toBe('/MY/')
    expect(it.meaning).toBe('我的释义')
    expect(it.status).toBe('edited')
    expect(out.filled).toBe(0)
  })

  it('没东西可补 → 返回同一个引用（调用方据此跳过写库）', () => {
    const lib = markWord(createLibrary(), { word: 'hobble', articleId: 'A' }, TEST_NOW).library
    const first = enrichWithDict(lib, dict, undefined, TEST_NOW)
    const second = enrichWithDict(first.library, dict, undefined, TEST_NOW)
    expect(second.filled).toBe(0)
    expect(second.library).toBe(first.library)
  })

  it('词形变化也能查到（ensconced → ensconce）', () => {
    const lib = markWord(createLibrary(), { word: 'ensconced', articleId: 'A' }, TEST_NOW).library
    const out = enrichWithDict(lib, dict, undefined, TEST_NOW)
    expect(out.library.items[0].meaning).toContain('安顿')
  })

  it('连字符复合词查不到整词，也按末段后缀给出词性', () => {
    const lib = {
      ...createLibrary(),
      items: [
        vocabItem({ word: 'taxpayer-funded', lemma: 'taxpayer-funded', meaning: '由纳税人出资的', status: 'queried' }),
        vocabItem({ word: 'world-leading', lemma: 'world-leading', meaning: '世界领先的', status: 'queried' }),
      ],
    }
    const out = enrichWithDict(lib, dict, undefined, TEST_NOW)
    expect(out.library.items[0].partOfSpeech).toBe('adj.')
    expect(out.library.items[1].partOfSpeech).toBe('adj.')
    // 推出来的词性不冒充词典/AI 的结论
    expect(out.library.items[0].fieldSources?.partOfSpeech).toBeUndefined()
  })

  it('判不出来的复合词（末段是普通名词）不硬标词性', () => {
    const lib = {
      ...createLibrary(),
      items: [vocabItem({ word: 'waiting-times', lemma: 'waiting-times', status: 'unqueried' })],
    }
    const out = enrichWithDict(lib, dict, undefined, TEST_NOW)
    expect(out.library.items[0].partOfSpeech ?? null).toBeNull()
  })

  it('英英释义（可选传入的 M-W 查询）也补上', () => {
    const lib = markWord(createLibrary(), { word: 'run', articleId: 'A' }, TEST_NOW).library
    const out = enrichWithDict(lib, dict, (w) => (w === 'run' ? { en: 'to move with speed', pos: 'verb' } : null), TEST_NOW)
    expect(out.library.items[0].definition).toBe('to move with speed')
    expect(out.library.items[0].partOfSpeech).toBe('v.')
    expect(out.library.items[0].fieldSources).toMatchObject({ definition: 'dict', partOfSpeech: 'dict' })
  })

  it('已有释义时不补词性：词典给的是词头最常用义项，会和语境释义打架', () => {
    // consort 真实病例：AI 查词给动词义「交往；厮混」，词典 M-W 首义是名词 → 卡上「n. 交往；厮混」
    const lib = {
      ...createLibrary(),
      items: [vocabItem({ word: 'consort', lemma: 'consort', meaning: '交往；厮混', fieldSources: { meaning: 'ai' } })],
    }
    const out = enrichWithDict(lib, dict, (w) => (w === 'consort' ? { pos: 'noun', en: 'to keep company with' } : null), TEST_NOW)
    const it = out.library.items[0]
    expect(it.meaning).toBe('交往；厮混')
    expect(it.partOfSpeech).toBeNull()
  })

  it('手动清空的字段不再被词典补回（只锁该字段，别的字段照补）', () => {
    const lib = {
      ...createLibrary(),
      items: [
        vocabItem({
          word: 'hobble',
          lemma: 'hobble',
          meaning: null,
          fieldSources: { meaning: 'manual' },
          status: 'edited',
        }),
      ],
    }
    const out = enrichWithDict(lib, dict, undefined, TEST_NOW)
    const it = out.library.items[0]
    expect(it.meaning).toBeNull()
    expect(it.phonetic).toBe("/'hɒbl/")
    expect(it.fieldSources).toMatchObject({ meaning: 'manual', phonetic: 'dict' })
  })
})
