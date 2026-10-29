/**
 * 打印窗口的唯一入口：`window.open` + `document.write`。
 *
 * 之前词表打印、金句本打印各写了一遍这 6 行；加第三个（学习历史）时收进来，
 * 免得以后一边修了「弹窗被拦截」另一边没修。调用方负责提示（返回 false 就是被拦了）。
 */
export function openPrintWindow(html: string, title: string): boolean {
  const win = window.open('', '_blank')
  if (!win) return false
  win.document.write(html)
  win.document.close()
  try {
    win.document.title = title
  } catch {
    // 窗口已经被关掉 / 跨域：标题设不上不影响打印内容
  }
  return true
}
