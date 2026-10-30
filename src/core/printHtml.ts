/**
 * A4 打印页的**公共外壳**：转义 + `<!doctype html>` 骨架 + 基础排版。
 *
 * 为什么收口：词表（`exports.renderPrintHTML`）、金句本（`goldenBank.goldenBankToPrintHTML`）、
 * 仿写批改（`writingExport.writingHistoryToPrintHTML`）各自抄了一遍转义函数和同一段
 * `@page / font-family / .meta` 样式。三份实现必然漂：修一处（比如换成安全字体、
 * 加 `-webkit-print-color-adjust`）另外两处不会跟着改，打出来就是三种版面。
 *
 * 各导出器只保留**自己那块布局样式**（分栏数、条目间距），公共部分走这里：
 * - `escapeHtml`：转义 `& < > "`（打印内容来自用户/AI 文本，必须转义，防注入）；
 * - `a4Document`：`@page size: A4` + 页边距 / 字号 / 行高参数化，样式顺序是
 *   「基础样式 → 调用方样式」，调用方要覆盖直接写同名选择器即可。
 *
 * 纯函数：不读 DOM、不看当前环境，Node 里也能单测。
 */

/** 转义 HTML 文本节点 / 属性值里的特殊字符（导出内容一律过这一层）。 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface A4DocumentInput {
  /** 文档标题（同时写进 `<title>` 和 `<h1>` 用的标题文本由调用方自己拼 body） */
  title: string
  /** 正文 HTML（已经拼好、已转义） */
  body: string
  /** 调用方自己的布局样式（分栏 / 条目间距等），追加在基础样式之后 */
  css?: string
  /** 页边距，默认 `10mm` */
  margin?: string
  /** 正文字号，默认 `9pt` */
  fontSize?: string
  /** 行高，默认 `1.4` */
  lineHeight?: string
}

/** 包一层 A4 打印文档外壳；返回完整 HTML 字符串（可直接 `document.write`）。 */
export function a4Document({
  title,
  body,
  css = '',
  margin = '10mm',
  fontSize = '9pt',
  lineHeight = '1.4',
}: A4DocumentInput): string {
  const own = css.trim()
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
@page { size: A4; margin: ${margin}; }
html, body { margin: 0; }
body { font-family: "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif; color: #111; font-size: ${fontSize}; line-height: ${lineHeight}; }
${own ? `${own}\n` : ''}</style></head><body>
${body}
</body></html>`
}
