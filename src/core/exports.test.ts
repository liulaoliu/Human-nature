import { describe, it, expect } from 'vitest'
import {
  dedupeByLemma,
  exportDocumentJSON,
  exportLibraryJSON,
  importDocumentJSON,
  importLibraryJSON,
  renderPrintHTML,
  toAnkiCSV,
  toWordsCSV,
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
    expect(html).toContain('columns: 2')
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
