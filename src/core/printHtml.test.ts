import { describe, expect, it } from 'vitest'
import { a4Document, escapeHtml } from './printHtml'

describe('escapeHtml', () => {
  it('转义 & < > "（顺序不能反：先 & 再其它）', () => {
    expect(escapeHtml('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;')
  })
  it('已经是实体的不会再转一遍', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;')
  })
})

describe('a4Document', () => {
  it('是完整 HTML，带 A4 页面与默认排版', () => {
    const html = a4Document({ title: '我的词表', body: '<p>hi</p>' })
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('@page { size: A4; margin: 10mm; }')
    expect(html).toContain('font-size: 9pt')
    expect(html).toContain('line-height: 1.4')
    expect(html).toContain('"PingFang SC"')
    expect(html.trimEnd().endsWith('</html>')).toBe(true)
  })

  it('标题转义，正文原样（正文由调用方负责转义）', () => {
    const html = a4Document({ title: '<script>x</script>', body: '<p>a &amp; b</p>' })
    expect(html).not.toContain('<title><script>')
    expect(html).toContain('<title>&lt;script&gt;x&lt;/script&gt;</title>')
    expect(html).toContain('<p>a &amp; b</p>')
  })

  it('页边距 / 字号 / 行高可覆盖；调用方样式排在基础样式之后（同级选择器后者优先）', () => {
    const html = a4Document({
      title: 't',
      body: '',
      margin: '12mm',
      fontSize: '9.5pt',
      lineHeight: '1.45',
      css: '  .items { columns: 2; }  ',
    })
    expect(html).toContain('margin: 12mm')
    expect(html).toContain('font-size: 9.5pt')
    expect(html).toContain('line-height: 1.45')
    expect(html.indexOf('body { font-family')).toBeLessThan(html.indexOf('.items { columns: 2; }'))
  })

  it('没有自定义样式也不留空行垃圾', () => {
    expect(a4Document({ title: 't', body: '' })).not.toContain('\n\n</style>')
  })
})
