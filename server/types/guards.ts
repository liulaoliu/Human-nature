/**
 * JSON / SQLite 边界的共用守卫（规范 §4.2：外部输入先 unknown，再具名 guard 收窄）。
 *
 * 数据来源：vocab / articles 的 payload 列 —— TEXT 存的
 * JSON，`JSON.parse` 出来的形状不可信。守卫规则：对象（含数组）放行，
 * 其余按「没有该字段」处理（undefined），不抛错、不把坏数据静默成空库。
 *
 * 注意：数组也算 record —— 与旧代码 `typeof v === 'object'` 的判断一致
 * （数组读字段同样得 undefined，读写属性同样生效），不要加 Array.isArray 排除。
 */

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

export function asRecord(v: unknown): Record<string, unknown> | null {
  return isRecord(v) ? v : null
}
