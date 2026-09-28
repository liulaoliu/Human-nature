import type { ScriptEditRepoPort } from '../core/ports'

const KEY = 'shadowing.scripts.v1'

/**
 * 手动改过的正文，按音频文件名存。
 *
 * 单独一个 key，不和校准混在一起 —— 校准每挪一个词就要写一次，
 * 正文几十 KB，混在一起会把每次微调都变成一次大写入。
 * 这里只在「保存文本」时写一次。
 */
export class LocalScriptEditRepo implements ScriptEditRepoPort {
  private read(): Record<string, string> {
    try {
      const raw = localStorage.getItem(KEY)
      return raw ? (JSON.parse(raw) as Record<string, string>) : {}
    } catch {
      return {}
    }
  }

  private write(all: Record<string, string>): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(all))
    } catch {
      // 隐私模式/超配额：静默放弃持久化，不影响本次使用
    }
  }

  get(fileName: string): string | undefined {
    return this.read()[fileName]
  }

  set(fileName: string, text: string): void {
    const all = this.read()
    all[fileName] = text
    this.write(all)
  }

  remove(fileName: string): void {
    const all = this.read()
    if (!(fileName in all)) return
    delete all[fileName]
    this.write(all)
  }
}

/** 没有 localStorage 时（单测/特殊环境）的内存版，行为一致 */
export class MemoryScriptEditRepo implements ScriptEditRepoPort {
  private map = new Map<string, string>()

  get(fileName: string): string | undefined {
    return this.map.get(fileName)
  }

  set(fileName: string, text: string): void {
    this.map.set(fileName, text)
  }

  remove(fileName: string): void {
    this.map.delete(fileName)
  }
}

export function createScriptEditRepo(): ScriptEditRepoPort {
  try {
    if (typeof localStorage === 'undefined') return new MemoryScriptEditRepo()
    return new LocalScriptEditRepo()
  } catch {
    return new MemoryScriptEditRepo()
  }
}
