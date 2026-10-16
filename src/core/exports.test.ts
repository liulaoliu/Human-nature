import { describe, it, expect } from 'vitest'
import {
  dedupeByLemma,
  exportDocumentJSON,
  exportLibraryJSON,
  importDocumentJSON,
  importLibraryJSON,
  renderPrintHTML,
  toAnkiCSV,
  toWordListTXT,
  toWordsCSV,
  toWrongWordsCSV,
} from './exports'
import { SCHEMA_VERSION, defaultReviewState } from '../types/document'
import type { EconomistDocument, VocabItem, VocabLibrary } from '../types/document'

function vocab(over: Partial<VocabItem> = {}): VocabItem {
  return {
    id: 'vocab:run',
    word: 'run',
    lemma: 'run',
    phonetic: '/rʌn/',
    partOfSpeech: 'v.',
    meaning: '跑',
    usage: ['run a business'],
    examples: [{ text: 'I run.', translation: '我跑。' }],
    source: { articleId: 'art1', fileName: null, sentenceId: 's1', sentenceText: 'I run.' },
    status: 'queried',
    note: '',
    tags: ['sport'],
    reviewState: defaultReviewState(),
    createdAt: '2026-10-02T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    ...over,
  }
}

describe('toAnkiCSV', () => {
  it('输出表头与两列内容', () => {
    const csv = toAnkiCSV([vocab()])
    const lines = csv.split('\n')
    expect(lines[0]).toBe('Front,Back,Tags')
    expect(lines[1]).toContain('run /rʌn/')
    expect(lines[1]).toContain('跑')
    expect(lines[1]).toContain('run a business')
    expect(lines[1]).toContain('I run.')
  })
  it('词组 / 习语 / 用法 在标签里标出类型', () => {
    const csv = toAnkiCSV([
      vocab({ id: 'vocab:x', word: 'fall back on', lemma: 'fall back on', kind: 'phrase', tags: [] }),
      vocab({ id: 'vocab:y', word: '注意 subject to 是形容词', lemma: '注意 subject to 是形容词', kind: 'usage', tags: [] }),
    ])
    expect(csv).toContain('词组')
    expect(csv).toContain('用法')
  })
  it('含逗号/引号的字段被正确转义', () => {
    const csv = toAnkiCSV([vocab({ meaning: '跑，快跑', word: 'say "hi"' })], { header: false })
    expect(csv).toContain('""hi""')
    expect(csv).toContain('"say ""hi""')
  })
  it('标签里的空格换成下划线', () => {
    const csv = toAnkiCSV([vocab({ source: { articleId: 'The green boom', fileName: null, sentenceId: null, sentenceText: '' }, tags: [] })])
    expect(csv).toContain('The_green_boom')
  })
})

describe('JSON 往返', () => {
  it('词库 export → import 不丢', () => {
    const lib: VocabLibrary = { schemaVersion: SCHEMA_VERSION, items: [vocab()] }
    expect(importLibraryJSON(exportLibraryJSON(lib))).toEqual(lib)
  })
  it('词库结构不对会抛错', () => {
    expect(() => importLibraryJSON('{"foo":1}')).toThrow()
  })
  it('文档 export → import 不丢', () => {
    const doc: EconomistDocument = {
      schemaVersion: SCHEMA_VERSION,
      meta: { id: 'x', title: 'T', issue: 'i', section: 's', sourceFormat: 'pdf_extract', audioFile: null, createdAt: 'c', updatedAt: 'u' },
      paragraphs: [{ id: 'p01', sentenceIds: ['s001'] }],
      sentences: [],
    }
    expect(importDocumentJSON(exportDocumentJSON(doc))).toEqual(doc)
  })
})

describe('renderPrintHTML', () => {
  const html = renderPrintHTML({ title: 'My Words', groups: [{ key: 'R', items: [vocab()] }] })

  it('是完整 HTML，带 A4 打印样式', () => {
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('@page')
    expect(html).toContain('size: A4')
    expect(html).toContain('columns: 3')
  })
  it('包含词条内容', () => {
    expect(html).toContain('My Words')
    expect(html).toContain('run')
    expect(html).toContain('跑')
  })
  it('转义 HTML 特殊字符，防止注入', () => {
    const evil = renderPrintHTML({ title: 'x', groups: [{ key: 'A', items: [vocab({ meaning: '<script>alert(1)</script>' })] }] })
    expect(evil).not.toContain('<script>')
    expect(evil).toContain('&lt;script&gt;')
  })
  it('词组 / 习语 / 用法 带类型小标签；单词不带', () => {
    const html2 = renderPrintHTML({
      title: '语言点',
      groups: [
        {
          key: '',
          items: [
            vocab(),
            vocab({ id: 'vocab:fall back on', word: 'fall back on', lemma: 'fall back on', kind: 'phrase', meaning: '转而依靠' }),
            vocab({ id: 'vocab:take', word: 'take its toll', lemma: 'take its toll', kind: 'idiom', meaning: '造成损害' }),
            vocab({ id: 'vocab:usage-1', word: '注意 subject to 是形容词', lemma: '注意 subject to 是形容词', kind: 'usage' }),
          ],
        },
      ],
    })
    expect(html2).toContain('词组')
    expect(html2).toContain('习语')
    expect(html2).toContain('用法')
    expect(html2).toContain('fall back on')
    expect(html2).toContain('注意 subject to 是形容词')
  })
  it('带标题 / 副标题 / 序号，空分组不渲染标题', () => {
    const numbered = renderPrintHTML({
      title: 'Bad-tempered',
      subtitle: '2026-10-03 · 1 词',
      groups: [{ key: '', items: [vocab({ word: 'run' })] }],
      numberOf: () => 7,
    })
    expect(numbered).toContain('<h1>Bad-tempered</h1>')
    expect(numbered).toContain('2026-10-03')
    expect(numbered).toContain('<span class="no">7</span>')
    expect(numbered).not.toContain('<h2>')
  })
})

describe('toWordsCSV', () => {
  it('导出 Word,Context 两列并转义', () => {
    const csv = toWordsCSV([{ word: 'run', context: 'I run, fast.' }, { word: 'go' }])
    expect(csv.split('\n')[0]).toBe('Word,Context')
    expect(csv).toContain('"I run, fast."')
    expect(csv.split('\n')[2]).toBe('go,')
  })
})

describe('输出去重', () => {
  it('dedupeByLemma 按 lemma 去重且保序', () => {
    const out = dedupeByLemma([
      vocab(),
      vocab({ id: 'b', word: 'go', lemma: 'go' }),
      vocab({ id: 'c', word: 'ran', lemma: 'run' }),
    ])
    expect(out.map((x) => x.lemma)).toEqual(['run', 'go'])
  })
  it('toAnkiCSV 去重', () => {
    const csv = toAnkiCSV([vocab(), vocab({ id: 'x', word: 'run', lemma: 'run' })], { header: false })
    expect(csv.split('\n')).toHaveLength(1)
  })
  it('toWordsCSV 按词去重（忽略大小写）', () => {
    const csv = toWordsCSV([{ word: 'Run' }, { word: 'run' }])
    expect(csv.split('\n')).toHaveLength(2)
  })
  it('renderPrintHTML 跨分组去重', () => {
    const html = renderPrintHTML({
      title: 'x',
      groups: [
        { key: 'A', items: [vocab()] },
        { key: 'B', items: [vocab({ id: 'y', lemma: 'run', word: 'run' })] },
      ],
    })
    expect(html.match(/class="word">run/g)?.length).toBe(1)
  })
})

describe('toWrongWordsCSV', () => {
  it('只导出出错过的词，含次数', () => {
    const csv = toWrongWordsCSV([
      vocab({ reviewState: { ease: 2.5, due: null, interval: 1, repetitions: 1, lapses: 3 } }),
      vocab({ id: 'b', lemma: 'go', word: 'go', reviewState: { ease: 2.5, due: null, interval: 1, repetitions: 1, lapses: 0 } }),
    ])
    const lines = csv.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('run')
    expect(lines[1]).toContain('3')
  })
})

describe('toWordListTXT', () => {
  it('每行一个单词，升序，去重（忽略大小写）', () => {
    const txt = toWordListTXT([vocab({ word: 'run' }), vocab({ id: 'x', word: 'Run', lemma: 'run2' }), vocab({ id: 'y', word: 'apple', lemma: 'apple' })])
    expect(txt).toBe('apple\nrun\n')
  })
  it('默认跳过词组和含标点的条目（背单词 App 不认）', () => {
    const txt = toWordListTXT([
      vocab({ word: 'give up' }),
      vocab({ id: 'x', word: 'shield sb/sth from sth' }),
      vocab({ id: 'y', word: 'bank (approval)' }),
      vocab({ id: 'z', word: 'well-known', lemma: 'well-known' }),
    ])
    expect(txt).toBe('well-known\n')
  })
  it('includePhrases 时保留词组', () => {
    const txt = toWordListTXT([vocab({ word: 'give up' })], { includePhrases: true })
    expect(txt).toBe('give up\n')
  })
  it('没有可导出时返回空串', () => {
    expect(toWordListTXT([vocab({ word: 'give up' })])).toBe('')
  })
})
