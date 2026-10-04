/** 阅读/练习界面的小格式化工具（纯函数）。 */

/** 秒 → `m:ss` 或 `h:mm`（用于计时与统计）。 */
export function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}:${String(sec % 60).padStart(2, '0')}`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

/** 复习间隔（天）→「稍后 / 明天 / N 天后 / N 个月后」。 */
export function fmtInterval(days: number): string {
  if (days <= 0) return '稍后'
  if (days === 1) return '明天'
  if (days < 30) return `${days} 天后`
  return `${Math.round(days / 30)} 个月后`
}

/** 到期时间（ISO）→「现在 / 明天 / N 天后」。 */
export function fmtDue(iso: string | null): string {
  if (!iso) return ''
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
  if (days <= 0) return '现在'
  if (days === 1) return '明天'
  return `${days} 天后`
}
