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
    'run\trʌn\t\tv. move fast\tn. 跑\tcet4\t5\t1\t100\t100',
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

  it('英英释义（可选传入的 M-W 查询）也补上', () => {
    const lib = markWord(createLibrary(), { word: 'run', articleId: 'A' }, TEST_NOW).library
    const out = enrichWithDict(lib, dict, (w) => (w === 'run' ? { en: 'to move with speed', pos: 'verb' } : null), TEST_NOW)
    expect(out.library.items[0].definition).toBe('to move with speed')
    expect(out.library.items[0].partOfSpeech).toBe('v.')
  })
})
