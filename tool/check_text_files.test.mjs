import { describe, expect, it } from 'vitest'
import { auditTextFiles } from './check_text_files.mjs'

/** 造一份「在 offset 处塞了一个 NUL」的字节，模拟源码里写了字面量 NUL。 */
function withNulAt(text, offset) {
  const raw = Buffer.from(text, 'utf8')
  return new Uint8Array(Buffer.concat([raw.slice(0, offset), Buffer.from([0]), raw.slice(offset)]))
}

describe('纯文本门禁', () => {
  it('NUL 字节：报出文件 + 行号 + 修法', () => {
    const text = 'const a = 1\nconst k = [a].join()\n'
    const res = auditTextFiles([{ file: 'src/x.ts', bytes: withNulAt(text, 27) }])
    expect(res.violations).toHaveLength(1)
    expect(res.violations[0]).toContain('src/x.ts:2')
    expect(res.violations[0]).toContain('NUL')
    expect(res.violations[0]).toContain("'\\u0000'")
  })

  it('正常 UTF-8（含中文 / emoji）不报', () => {
    const res = auditTextFiles([
      { file: 'src/a.ts', bytes: new Uint8Array(Buffer.from('const 中文 = "✅"\n', 'utf8')) },
    ])
    expect(res.violations).toEqual([])
  })

  it('非法 UTF-8（GBK 存盘）报出来', () => {
    // 0xD6 0xD0 是 GBK 的「中」，在 UTF-8 里是非法字节
    const res = auditTextFiles([{ file: 'docs/b.md', bytes: new Uint8Array([0xd6, 0xd0, 0x0a]) }])
    expect(res.violations.join('\n')).toContain('docs/b.md 不是合法 UTF-8')
  })
})
