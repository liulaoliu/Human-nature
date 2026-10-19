/**
 * 备份导入账本：同一份文件「合并导入」第二次直接跳过。
 *
 * 为什么需要：`mergeStudyDays` / `mergeActivity` 是**按天累加**语义（两台机器的
 * 学习时长确实该相加），没有来源 id 就没法做成数学意义上的幂等。但用户最常见的
 * 误操作是「同一个文件点两次合并」，这可以用文件指纹挡住，且不影响不同文件相加。
 */
export const IMPORT_LEDGER_LIMIT = 20

/** FNV-1a 32 位；只用于「是不是同一份文件」，不做安全哈希。 */
export function backupFingerprint(text: string): string {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  }
  return (h >>> 0).toString(36)
}

/** 把指纹记进账本（新的在前，最多 20 个）。 */
export function rememberImport(ledger: readonly string[], fingerprint: string): string[] {
  return [fingerprint, ...ledger.filter((x) => x !== fingerprint)].slice(0, IMPORT_LEDGER_LIMIT)
}

export function hasImported(ledger: readonly string[], fingerprint: string): boolean {
  return ledger.includes(fingerprint)
}

/** 从 localStorage 读账本；坏数据当空账本（不抛）。 */
export function parseImportLedger(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, IMPORT_LEDGER_LIMIT) : []
  } catch {
    return []
  }
}
