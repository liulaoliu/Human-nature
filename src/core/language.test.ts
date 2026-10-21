import { describe, it, expect } from 'vitest'
import {
  EMPTY_LANGUAGE_FORM,
  applyLanguage,
  buildLanguagePrompt,
  getSentenceLanguages,
  languageFromForm,
  languagePreview,
  languageToForm,
  parseLanguage,
  splitLanguageList,
} from './language'
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

describe('语言点编辑表单（阅读 / 速读共用一份规则）', () => {
  it('列表字段：分号 / 顿号 / 换行都算分隔，去空去重', () => {
    expect(splitLanguageList(' a；b; a\n c 、')).toEqual(['a', 'b', 'c'])
    expect(splitLanguageList('   ')).toEqual([])
  })

  it('表单 → 语言点：空字段不写；全是空白时返回空对象', () => {
    expect(languageFromForm(EMPTY_LANGUAGE_FORM)).toEqual({})
    expect(
      languageFromForm({
        structure: 'SVO\n（主句）',
        grammar: '一般现在时',
        idioms: 'run fast\nwalk slow',
        phrases: '',
        usage: '用于口语',
      }),
    ).toEqual({
      structure: 'SVO\n（主句）',
      grammar: '一般现在时',
      idioms: ['run fast', 'walk slow'],
      usage: ['用于口语'],
    })
  })

  it('结构 / 语法保留原始换行与行首缩进（粘贴格式不变形）', () => {
    expect(
      languageFromForm({ ...EMPTY_LANGUAGE_FORM, structure: '主句\n  从句', grammar: '  缩进\n第二行' }),
    ).toEqual({ structure: '主句\n  从句', grammar: '  缩进\n第二行' })
  })

  it('语言点 → 表单：列表用「；」连起来，再解析回同一条数据', () => {
    const L = { structure: 'SV', grammar: '时态', idioms: ['a', 'b'], usage: ['u'] }
    const form = languageToForm(L)
    expect(form.idioms).toBe('a；b')
    expect(languageFromForm(form)).toEqual(L)
  })

  it('列表摘要：结构里的换行压成空格', () => {
    expect(languagePreview({ structure: 'SVO\n主句', grammar: '现在时', idioms: ['x'] })).toBe('SVO 主句 ｜ 现在时 ｜ x')
  })
})

describe('旧语言点兼容（编辑要能回填）', () => {
  it('单条 language + 列表字段是字符串：归一成数组，新行不被吞掉', () => {
    const legacy = {
      language: {
        structure: '第一行\n第二行',
        idioms: 'run fast；walk slow\nall in' as unknown as string[],
        usage: '口语' as unknown as string[],
      },
    }
    const [L] = getSentenceLanguages(legacy as unknown as { language: SentenceLanguage })
    expect(L).toMatchObject({ structure: '第一行\n第二行', idioms: ['run fast', 'walk slow', 'all in'], usage: ['口语'], source: 'ai' })
  })

  it('languageToForm 遇到字符串 / 缺字段也不炸，能回填成可编辑文本', () => {
    const legacy = { structure: 'SVO', idioms: 'a；b' as unknown as string[], phrases: undefined }
    expect(languageToForm(legacy as unknown as SentenceLanguage)).toEqual({ structure: 'SVO', grammar: '', idioms: 'a；b', phrases: '', usage: '' })
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
