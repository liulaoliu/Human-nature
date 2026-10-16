import { describe, it, expect } from 'vitest'
import { applyLanguage, buildLanguagePrompt, languagePointsOf, parseLanguage } from './language'
import type { Sentence, SentenceLanguage } from '../types/document'

function sentence(id: string, text = 'Hello.'): Sentence {
  return {
    id,
    paraId: 'p01',
    text,
    audio: null,
    translation: null,
    grammarNote: null,
    collocations: [],
    vocab: [],
    tags: [],
    reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
  }
}

describe('buildLanguagePrompt', () => {
  it('含句 id 与 JSON schema', () => {
    const p = buildLanguagePrompt([{ id: 's001', text: 'The quick fox.' }])
    expect(p).toContain('s001 | The quick fox.')
    expect(p).toContain('"sentences"')
    expect(p).toContain('structure')
    expect(p).toContain('idioms')
  })
})

describe('parseLanguage', () => {
  it('解析合法 JSON（含栅欄）', () => {
    const raw =
      '```json\n{"sentences":[{"id":"s001","structure":"主谓宾","grammar":"一般过去时","idioms":["break the ice"],"phrases":["a quick fox"],"usage":["fox 指狐狸"]}]}\n```'
    const rows = parseLanguage(raw)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 's001', structure: '主谓宾', grammar: '一般过去时' })
    expect(rows[0].idioms).toEqual(['break the ice'])
  })
  it('丢弃没有 id 或全空的项', () => {
    const raw = JSON.stringify({ sentences: [{ structure: 'x' }, { id: 's002' }, { id: 's003', grammar: 'g' }] })
    const rows = parseLanguage(raw)
    expect(rows.map((r) => r.id)).toEqual(['s003'])
  })
  it('非法 JSON → 空', () => {
    expect(parseLanguage('nope')).toEqual([])
  })
  it('前后夹着说明文字也能抠出 JSON', () => {
    const raw =
      '好的，下面是分析结果：\n{"sentences":[{"id":"s001","grammar":"present tense"}]}\n希望有帮助！'
    const rows = parseLanguage(raw)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('s001')
  })
  it('模型偶发非法反斜杠转义（\\( \\) \\[ \\]）也能修好', () => {
    const raw =
      '{"sentences":[{"id":"s001","structure":"主句","phrases":\\("a b", "c d"\\),"idioms":\\("x"\\),"usage":\\("u"\\)}]}'
    const rows = parseLanguage(raw)
    expect(rows).toHaveLength(1)
    expect(rows[0].phrases).toEqual(['a b', 'c d'])
  })
})

describe('applyLanguage', () => {
  it('按 id 写回（写入 languages，标 source=ai），未命中的不动', () => {
    const sents = [sentence('s001'), sentence('s002', 'Other.')]
    const out = applyLanguage(sents, [{ id: 's001', structure: '主谓', phrases: ['a b'] }])
    expect(out[0].languages?.[0]).toMatchObject({ structure: '主谓', phrases: ['a b'], source: 'ai' })
    expect(out[1].languages).toBeUndefined()
  })
  it('AI 只替换 AI 那条，保留手动条目', () => {
    const base = sentence('s001')
    const withManual = { ...base, languages: [{ grammar: '手动语法', source: 'manual' as const }] }
    const out = applyLanguage([withManual], [{ id: 's001', structure: '主谓' }])
    expect(out[0].languages).toHaveLength(2)
    expect(out[0].languages?.[0]).toMatchObject({ structure: '主谓', source: 'ai' })
    expect(out[0].languages?.[1]).toMatchObject({ grammar: '手动语法', source: 'manual' })
  })
  it('写入时间戳 at（用于「哪天加的语言点」）', () => {
    const now = new Date('2026-10-15T03:00:00.000Z')
    const out = applyLanguage([sentence('s001')], [{ id: 's001', grammar: 'x' }], now)
    expect(out[0].languages?.[0].at).toBe('2026-10-15T03:00:00.000Z')
  })
})

describe('languagePointsOf（语言点自动收藏：词组 / 习语 / 用法）', () => {
  const withLang = (id: string, text: string, L: SentenceLanguage): Sentence => ({ ...sentence(id, text), languages: [L] })

  it('抽取三类条目，词组/习语把「英文 — 中文」拆成 词条 + 释义，并带来源句', () => {
    const sents = [
      withLang('s1', 'It takes its toll and we fall back on it.', {
        phrases: ['fall back on — 转而依靠'],
        idioms: ['take its toll — 造成损害'],
        usage: ['注意 subject to 这里是形容词，表示「易受…影响」'],
        source: 'ai',
      }),
    ]
    const pts = languagePointsOf(sents, { articleId: 'A', fileName: 'A' })
    expect(pts).toEqual([
      {
        kind: 'phrase',
        word: 'fall back on',
        gloss: '转而依靠',
        source: { articleId: 'A', fileName: 'A', sentenceId: 's1', sentenceText: 'It takes its toll and we fall back on it.' },
      },
      {
        kind: 'idiom',
        word: 'take its toll',
        gloss: '造成损害',
        source: { articleId: 'A', fileName: 'A', sentenceId: 's1', sentenceText: 'It takes its toll and we fall back on it.' },
      },
      {
        kind: 'usage',
        // 用法是中文说明：不拆「英文 — 中文」，整句留着
        word: '注意 subject to 这里是形容词，表示「易受…影响」',
        gloss: undefined,
        source: { articleId: 'A', fileName: 'A', sentenceId: 's1', sentenceText: 'It takes its toll and we fall back on it.' },
      },
    ])
  })

  it('没有语言点 / 空句数组 → 空；兼容旧的单条 language 字段', () => {
    expect(languagePointsOf([], { articleId: 'A' })).toEqual([])
    expect(languagePointsOf([sentence('s1')], { articleId: 'A' })).toEqual([])
    const legacy: Sentence = { ...sentence('s2', 'Old.'), language: { phrases: ['run out'] } }
    expect(languagePointsOf([legacy], { articleId: 'A' }).map((p) => p.word)).toEqual(['run out'])
  })
})
