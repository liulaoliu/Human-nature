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
