import { hasModifier, isComposing, isEditableTarget } from './hotkeys'

/** 复读模式接管的键。速读的全局处理器看到这些键要让开（同优先级会同时收到事件）。 */
const REPEAT_KEYS = new Set([' ', 'r', 'c', 'a', 'd', 'arrowleft', 'arrowright', 'escape'])

export function isRepeatHotkey(e: KeyboardEvent): boolean {
  if (isComposing(e) || isEditableTarget(e.target) || hasModifier(e)) return false
  return REPEAT_KEYS.has(e.key.toLowerCase())
}
