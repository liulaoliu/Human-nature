import { describe, it, expect } from 'vitest'
import { carryAnalysis, segment, splitSentences } from './segmenter'
import type { Sentence } from '../types/document'

describe('splitSentences', () => {
  it('基本句切分', () => {
    expect(splitSentences('He left. She stayed.')).toEqual(['He left.', 'She stayed.'])
  })

  it('问号感叹号也切', () => {
    expect(splitSentences('Really? Yes! Fine.')).toEqual(['Really?', 'Yes!', 'Fine.'])
  })

  it('缩写不误切：Mr.', () => {
    expect(splitSentences('Mr. Smith went home. He was tired.')).toEqual([
      'Mr. Smith went home.',
      'He was tired.',
    ])
  })

  it('缩写不误切：U.S.', () => {
    expect(splitSentences('The U.S. economy grew. Then it slowed.')).toEqual([
      'The U.S. economy grew.',
      'Then it slowed.',
    ])
  })

  it('缩写不误切：e.g.', () => {
    expect(splitSentences('Some plans, e.g. the new one, failed. It was costly.')).toEqual([
      'Some plans, e.g. the new one, failed.',
      'It was costly.',
    ])
  })

  it('单句', () => {
    expect(splitSentences('Just one sentence.')).toEqual(['Just one sentence.'])
  })
})

describe('segment', () => {
  const text = 'First sentence. Second sentence.\n\nAnother paragraph here.'

  it('按空行生成段落，段内切句', () => {
    const { paragraphs, sentences } = segment(text)
    expect(paragraphs).toHaveLength(2)
    expect(sentences).toHaveLength(3)
    expect(paragraphs[0]).toEqual({ id: 'p01', sentenceIds: ['s001', 's002'] })
    expect(paragraphs[1]).toEqual({ id: 'p02', sentenceIds: ['s003'] })
  })

  it('句子顺序与原文一致，paraId 正确', () => {
    const { sentences } = segment(text)
    expect(sentences.map((s) => s.text)).toEqual([
      'First sentence.',
      'Second sentence.',
      'Another paragraph here.',
    ])
    expect(sentences[2].paraId).toBe('p02')
  })

  it('句子的默认字段正确', () => {
    const { sentences } = segment('Hello there.')
    expect(sentences[0]).toMatchObject({
      id: 's001',
      paraId: 'p01',
      text: 'Hello there.',
      audio: null,
      translation: null,
      grammarNote: null,
      collocations: [],
      vocab: [],
      tags: [],
    })
    expect(sentences[0].reviewState).toEqual({ ease: 2.5, due: null, interval: 0, repetitions: 0 })
  })

  it('空输入没有段落和句子', () => {
    expect(segment('')).toEqual({ paragraphs: [], sentences: [] })
  })

  it('只有空白也没有段落', () => {
    expect(segment('   \n\n  ')).toEqual({ paragraphs: [], sentences: [] })
  })

  it('id 超过 9 时补零到两位 / 三位', () => {
    const many = Array.from({ length: 12 }, (_, i) => `Sentence number ${i}.`).join(' ')
    const { paragraphs, sentences } = segment(many)
    expect(paragraphs[0].id).toBe('p01')
    expect(sentences[11].id).toBe('s012')
  })
})

describe('carryAnalysis', () => {
  const base = (text: string): Sentence => ({
    id: 'x',
    paraId: 'p01',
    text,
    audio: { start: 1, end: 2 },
    translation: '译',
    grammarNote: '语法',
    collocations: ['c'],
    vocab: ['v'],
    tags: ['t'],
    reviewState: { ease: 2.5, due: null, interval: 0, repetitions: 0 },
  })

  it('句文相同就搬分析结果', () => {
    const [out] = carryAnalysis([base('Hello world.')], segment('Hello world.').sentences)
    expect(out.translation).toBe('译')
    expect(out.grammarNote).toBe('语法')
    expect(out.collocations).toEqual(['c'])
    expect(out.audio).toEqual({ start: 1, end: 2 })
  })
  it('句文变了就不搬', () => {
    const [out] = carryAnalysis([base('Hello world.')], segment('Goodbye moon.').sentences)
    expect(out.translation).toBeNull()
  })
  it('同一句文出现多次按顺序一一对应', () => {
    const prev = [base('Same.'), { ...base('Same.'), translation: '第二处' }]
    const out = carryAnalysis(prev, segment('Same. Same.').sentences)
    expect(out[0].translation).toBe('译')
    expect(out[1].translation).toBe('第二处')
  })
})
