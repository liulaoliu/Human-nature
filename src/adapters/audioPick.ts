/**
 * 选音频文件：尽量「记住上次目录」。
 *
 * 普通 `<input type=file>` **不能**指定起始目录（浏览器安全限制）。所以：
 *   - 支持 File System Access API（Chromium/Edge + localhost 安全上下文）时，
 *     用 `showOpenFilePicker({ startIn })`，并把上次的文件句柄存进 IndexedDB，
 *     下次从它所在的目录打开 —— 真正做到「记住上次目录」。
 *   - 不支持时返回 null，调用方回退到普通 input（浏览器自身一般也会记住上次目录）。
 *
 * 无 DOM 环境（单测/node）下全部安全跳过。
 */

const DB_NAME = 'shadowing-fs'
const STORE = 'kv'
const KEY = 'lastAudioHandle'

interface FsFileHandle {
  getFile(): Promise<File>
}
interface FsPickerWindow {
  showOpenFilePicker?: (opts?: {
    types?: { description?: string; accept: Record<string, string[]> }[]
    startIn?: unknown
    multiple?: boolean
    excludeAcceptAllOption?: boolean
  }) => Promise<FsFileHandle[]>
}

const AUDIO_TYPES = [
  {
    description: '音频',
    accept: { 'audio/*': ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.flac'] },
  },
]

function hasIdb(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(key: string): Promise<unknown> {
  if (!hasIdb()) return undefined
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return undefined
  }
}

async function idbSet(key: string, val: unknown): Promise<void> {
  if (!hasIdb()) return
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(val, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // 忽略
  }
}

/** 当前环境是否支持 File System Access 选文件（Chromium + 安全上下文）。 */
export function supportsAudioPicker(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as FsPickerWindow).showOpenFilePicker === 'function'
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError'
}

/**
 * 打开选音频对话框（记住上次目录）。返回选中的文件；取消 / 不支持返回 null。
 */
export async function pickAudioFile(): Promise<File | null> {
  if (typeof window === 'undefined') return null
  const w = window as unknown as FsPickerWindow
  if (typeof w.showOpenFilePicker !== 'function') return null

  const open = async (startIn?: unknown): Promise<File | null> => {
    const handles = await w.showOpenFilePicker!({
      types: AUDIO_TYPES,
      startIn,
      excludeAcceptAllOption: false,
    })
    const h = handles[0]
    if (!h) return null
    const file = await h.getFile()
    void idbSet(KEY, h) // 存句柄，下次 startIn 用它所在目录
    return file
  }

  try {
    const last = await idbGet(KEY)
    return await open(last ?? undefined)
  } catch (e) {
    if (isAbort(e)) return null
    // 记的句柄失效等：退回默认目录再试一次
    try {
      return await open(undefined)
    } catch (e2) {
      if (isAbort(e2)) return null
      return null
    }
  }
}
