/**
 * 文本比对键：去首尾空白、折叠连续空白、转小写。
 *
 * 词库 / 错题 / 产出目标 / 金句解析都靠它判「是不是同一段文本」。
 * **只此一份**：以前 `mistakes` / `production` / `productionHistory` / `spelling`
 * 各写了一遍 `trim().toLowerCase().replace(/\s+/g, ' ')`，改一处漏三处。
 *
 * 注意：只保留大小写的场景（例如按原样展示 / 大小写敏感匹配）不要用它。
 */
export function normalizeTextKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}
