import { describe, expect, it } from 'vitest'
import { sentenceFixture } from './testFixtures'
import { isRepeatTakeFor, repeatTakeId, repeatTakeName, type RepeatTake } from './repeatTake'

function take(over: Partial<RepeatTake> = {}): RepeatTake {
  return {
    id: repeatTakeId('doc:1', 's1'),
    articleKey: 'doc:1',
    sentenceId: 's1',
    sentenceText: 'Run fast.',
    blob: new Blob(['x'], { type: 'audio/webm' }),
    mimeType: 'audio/webm',
    durationSec: 2,
    createdAt: 1,
    ...over,
  }
}

describe('repeatTakeId', () => {
  it('同一篇同一句稳定；不同篇/不同句不撞', () => {
    expect(repeatTakeId('a', 's1')).toBe(repeatTakeId('a', 's1'))
    expect(repeatTakeId('a', 's1')).not.toBe(repeatTakeId('b', 's1'))
    expect(repeatTakeId('a', 's1')).not.toBe(repeatTakeId('a', 's2'))
  })
})

describe('isRepeatTakeFor：文本戳挡住 id 漂移', () => {
  const sentence = sentenceFixture('s1', 'Run fast.')

  it('id 与文本都一致才算', () => {
    expect(isRepeatTakeFor(take(), sentence)).toBe(true)
  })

  it('正文改过（同一 id 换了文本）→ 不认', () => {
    expect(isRepeatTakeFor(take(), sentenceFixture('s1', 'Run faster.'))).toBe(false)
  })

  it('句子 id 漂移 → 不认', () => {
    expect(isRepeatTakeFor(take(), sentenceFixture('s2', 'Run fast.'))).toBe(false)
  })
})

describe('repeatTakeName', () => {
  it('标题里的非法文件名字符会换掉，句序补零', () => {
    expect(repeatTakeName('A/B: "test"?', 2)).toBe('A_B_ _test_-03.webm')
  })

  it('空标题有兜底', () => {
    expect(repeatTakeName('   ', 0)).toBe('复读-01.webm')
  })
})
