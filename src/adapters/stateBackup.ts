import {
  backupFileName,
  makeBackup,
  parseBackup,
  PROJECT_STATE_FILE,
  type StateBackup,
} from '../core/stateBackup'

/** 我们自己写的 localStorage 键都带这个前缀，导出/导入只碰这些 */
const PREFIX = 'shadowing.'

export function collectLocalState(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(PREFIX)) continue
      const value = localStorage.getItem(key)
      if (value !== null) out[key] = value
    }
  } catch {
    // 隐私模式：拿不到就当空的
  }
  return out
}

/** 把备份覆盖写进 localStorage（只认我们前缀的键） */
export function applyLocalState(data: Record<string, string>): number {
  let n = 0
  try {
    for (const [key, value] of Object.entries(data)) {
      if (!key.startsWith(PREFIX)) continue
      localStorage.setItem(key, value)
      n++
    }
  } catch {
    // 存不下就算了
  }
  return n
}

export function localStateIsEmpty(): boolean {
  return Object.keys(collectLocalState()).length === 0
}

export function currentBackup(): StateBackup {
  return makeBackup(collectLocalState())
}

/** 浏览器下载一份备份 */
export function downloadBackup(backup: StateBackup): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = backupFileName()
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * 让 dev server 把备份写到 `public/shadowing-state.json`。
 * 生产/预览没有这个接口，返回 false，由调用方退回「下载」。
 */
export async function saveToProject(backup: StateBackup): Promise<boolean> {
  try {
    const res = await fetch('/__state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backup),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * 读项目里的种子文件（public/shadowing-state.json）。
 * 只在 localStorage 还空着（新电脑第一次打开）时用来初始化。
 */
export async function loadProjectSeed(): Promise<StateBackup | null> {
  try {
    const res = await fetch(PROJECT_STATE_FILE, { cache: 'no-store' })
    if (!res.ok) return null
    return parseBackup(await res.text())
  } catch {
    return null
  }
}
