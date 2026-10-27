/**
 * 全局键盘的**唯一入口**：按优先级只让「当前模式」处理按键。
 *
 * 以前每个会话/面板各挂一个 `window.addEventListener('keydown')`，靠内部
 * 「当前是不是我」判断。新增模式时很容易忘屏蔽旧模式，一次按键触发两个动作
 * （例如考试里按 Q 又切了背单词）。现在：
 *   - 同一时刻只有最高优先级的已启用处理器会收到事件；
 *   - 同优先级允许多个（如 ReaderApp 的 Ctrl 跟踪 + 正文快捷键）；
 *   - 处理器引用每帧更新，不需要把它塞进 effect 依赖。
 */
type Handler = (e: KeyboardEvent) => void
interface Entry {
  priority: number
  handler: Handler
}

/** 当前焦点是不是文本输入：全局快捷键默认不抢，除非该键明确是提交。 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || !!el.isContentEditable)
}

/** Ctrl / ⌘ / Alt 组合键不归普通单键快捷键处理。 */
export function hasModifier(e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  return e.ctrlKey || e.metaKey || e.altKey
}

/** 中文输入法组合中的 keydown 不能当快捷键（否则回车选词会被吃掉）。 */
export function isComposing(e: Pick<KeyboardEvent, 'isComposing'>): boolean {
  return e.isComposing
}

const entries = new Map<symbol, Entry>()
let installed = false

function dispatch(e: KeyboardEvent): void {
  let top = Number.NEGATIVE_INFINITY
  for (const { priority } of entries.values()) {
    if (priority > top) top = priority
  }
  if (top === Number.NEGATIVE_INFINITY) return
  // 复制一份：处理器里可能注销自己（如 Esc 退出）
  for (const { priority, handler } of [...entries.values()]) {
    if (priority === top) handler(e)
  }
}

function install(): void {
  if (installed || typeof window === 'undefined') return
  window.addEventListener('keydown', dispatch)
  installed = true
}

function uninstall(): void {
  if (!installed || typeof window === 'undefined') return
  window.removeEventListener('keydown', dispatch)
  installed = false
}

/** 注册一个处理器；返回值用于注销。 */
export function registerHotkeys(priority: number, handler: Handler): () => void {
  const id = Symbol('hotkeys')
  entries.set(id, { priority, handler })
  install()
  return () => {
    entries.delete(id)
    if (!entries.size) uninstall()
  }
}

/** 测试用：清空注册表与全局监听。 */
export function resetHotkeysForTest(): void {
  entries.clear()
  uninstall()
}
