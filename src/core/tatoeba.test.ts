import { describe, it, expect } from 'vitest'
import { examplesFor, parseTatoeba } from './tatoeba'

const TSV = [
  'mitigate\tThe drug can mitigate the pain.\t这种药能减轻疼痛。',
  'mitigate\tWe must mitigate the risks.\t我们必须降低风险。',
  'risk\tSmoking increases the risk of cancer.\t吸烟增加患癌风险。',
  '风险\t这是中文句子（应被忽略）\t中文',
].join('\n')

describe('parseTatoeba / examplesFor', () => {
  it('按词索引例句（英文 + 中文）', () => {
    const t = parseTatoeba(TSV)
    expect(examplesFor(t, 'mitigate')).toEqual([
      { en: 'The drug can mitigate the pain.', zh: '这种药能减轻疼痛。' },
      { en: 'We must mitigate the risks.', zh: '我们必须降低风险。' },
    ])
  })

  it('查不到返回空；按词形优先、再原形', () => {
    const t = parseTatoeba('run\tI run every day.\t我每天跑步。')
    expect(examplesFor(t, 'running', 'run')).toEqual([{ en: 'I run every day.', zh: '我每天跑步。' }])
    expect(examplesFor(t, 'zzz')).toEqual([])
  })

  it('每词最多 cap 条、去重', () => {
    const t = parseTatoeba(
      ['a\tOne.\t一', 'a\tOne.\t一', 'a\tTwo.\t二', 'a\tThree.\t三'].join('\n'),
      2,
    )
    expect(examplesFor(t, 'a').map((x) => x.en)).toEqual(['One.', 'Two.'])
  })

  it('缺列 / 空行跳过', () => {
    expect(parseTatoeba('\nfoo\tbar\n\n').byWord.size).toBe(0)
  })
})
