/**
 * 单测数据工厂（**测试专用**，不进生产包：文件名不是 *.test.ts，但只被测试引用）。
 *
 * 为什么要有它：工厂散在各个 test 文件里，会让「词条长什么样」这件事有好几份定义，
 * 加字段时到处漏改。统一在这里造数据，测试只描述**关心的那部分**（`over` 覆盖）。
 */
import { defaultReviewState, type Sentence, type VocabItem } from '../types/document'

/** 造一个词条（默认是最普通的「已查过」的单词）。 */
export function vocabItem(over: Partial<VocabItem> = {}): VocabItem {
  const iso = '2026-10-02T00:00:00.000Z'
  return {
    id: 'vocab:test',
    word: 'test',
    lemma: 'test',
    phonetic: null,
    partOfSpeech: null,
    meaning: null,
    usage: [],
    examples: [],
    source: null,
    status: 'unqueried',
    note: '',
    tags: [],
    reviewState: defaultReviewState(),
    createdAt: iso,
    updatedAt: iso,
    ...over,
  }
}

/** 造一个句子（默认没有任何语言点）。 */
export function sentenceFixture(id: string, text = 'Hello.', over: Partial<Sentence> = {}): Sentence {
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
    reviewState: defaultReviewState(),
    ...over,
  }
}

/** 固定的「现在」，让时间相关断言稳定。 */
export const TEST_NOW = new Date('2026-10-02T00:00:00.000Z')
