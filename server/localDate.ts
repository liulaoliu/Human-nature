/**
 * 服务端日期键：一律用**本地日历日**，和客户端展示/打印同口径。
 *
 * 以前导出文件名和每日备份用 `toISOString().slice(0,10)`（UTC）：中国时区 0–8 点
 * 导出的文件会标成前一天，备份也会落到前一天的文件名上。这里不引入 04:00 结算
 * （那是学习统计的口径），文件名只表达“本机今天”。
 */
export function localDayKey(d: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
