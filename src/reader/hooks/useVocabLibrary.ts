import { useCallback, useEffect, useRef, useState } from 'react'
import type { VocabLibrary } from '../../types/document'
import type { VocabRepoPort } from '../../core/ports'
import { createLibrary } from '../../core/vocab'
import { migrateLibrary } from '../../core/migrations'
import { libraryErrors } from '../../core/libraryValidate'
import { createVocabRepo } from '../../adapters/vocabRepo'
import {
  createVocabSaver,
  type LibraryLoadState,
  type VocabSaver,
  PERSIST_DELAY_MS,
  PERSIST_MAX_WAIT_MS,
  PERSIST_RETRY_BASE_MS,
  PERSIST_RETRY_MAX_MS,
} from './vocabSaver'

export { PERSIST_DELAY_MS, PERSIST_MAX_WAIT_MS, PERSIST_RETRY_BASE_MS, PERSIST_RETRY_MAX_MS }
export type { LibraryLoadState }

/**
 * 词库的**持久化接线**：读回来 → 修数据 → 对外提供「写一次」的 persist。
 *
 * 为什么单独一个 hook：
 *   1. 它是「谁在什么时候写词库」这件事故高发区的唯一入口（读失败绝不写、写前留备份）；
 *   2. 抽出来后可以用假仓储直接测（见 useVocabLibrary.test.tsx），不用挂整个 ReaderApp；
 *   3. ReaderApp 只拿结果，不再自己管 repo/ref/加载态。
 *
 * 合并写 / 串行队列 / 退避重试 / 冲突停写这些规则在 `vocabSaver.ts`（纯状态机，不依赖 React），
 * 这里只管「读回来 + 把状态交给界面」。
 *
 * 事故背景（真实）：IndexedDB 读取失败时拿到的是**空库**，而当时的代码把加载态直接置 true，
 * 于是自动补全把「空库 + 语言点」写了回去 —— 生词全丢。现在：
 *   - 加载态三态化（pending / ok / failed），failed 时 persist **硬拒绝写入**并提示先导备份；
 *   - 落盘前由仓储追加历史快照，误清后可从快照 / 备份里手工救回（界面不提供一键退版）。
 */

export interface UseVocabLibraryParams {
  flash: (msg: string) => void
  /** 换实现用（测试注入假仓储；默认 IndexedDB，隐私模式退回内存） */
  createRepo?: () => VocabRepoPort
}

export interface UseVocabLibraryResult {
  library: VocabLibrary
  /** 同步持有的最新词库（给自动补全等「不想把 library 变成依赖」的地方读） */
  libraryRef: React.MutableRefObject<VocabLibrary>
  libraryLoad: LibraryLoadState
  /** 只有 ok 才允许自动补全写库 */
  libraryLoaded: boolean
  /** 唯一的写入入口（加载失败时拒绝写入） */
  persist: (lib: VocabLibrary) => void
  /** 立刻写入并等结果（导入备份用；失败会抛给调用方） */
  persistNow: (lib: VocabLibrary) => Promise<void>
}

export function useVocabLibrary({ flash, createRepo = createVocabRepo }: UseVocabLibraryParams): UseVocabLibraryResult {
  const [library, setLibrary] = useState<VocabLibrary>(() => createLibrary())
  const [libraryLoad, setLibraryLoad] = useState<LibraryLoadState>('pending')
  const repo = useRef<VocabRepoPort | null>(null)
  const libraryRef = useRef(library)
  libraryRef.current = library
  const libraryLoaded = libraryLoad === 'ok'

  /** 加载态的最新值（落盘引擎要问它「现在能不能写」）。 */
  const loadStateRef = useRef<LibraryLoadState>('pending')
  loadStateRef.current = libraryLoad
  /** flash 的最新引用：保存回来时组件可能已经重渲染过。 */
  const flashRef = useRef(flash)
  flashRef.current = flash

  /** 界面同步：state 和 ref 一起更新，caller 不用关心两者差异。 */
  const apply = useCallback((lib: VocabLibrary) => {
    libraryRef.current = lib
    setLibrary(lib)
  }, [])

  const saverRef = useRef<VocabSaver | null>(null)
  if (!saverRef.current) {
    saverRef.current = createVocabSaver({
      repo: () => repo.current,
      loadState: () => loadStateRef.current,
      apply,
      flash: (msg) => flashRef.current(msg),
    })
  }
  const saver = saverRef.current

  // 读回词库：修数据（去重 / 语法标记 / 早先版本误标的类型），修过就写回去
  useEffect(() => {
    const r = createRepo()
    repo.current = r
    r.load()
      .then((raw) => {
        // 老数据兼容 / 清洗 / 去重**统一收口**在 core/migrations；顺手自检不变量
        const fixed = migrateLibrary(raw)
        const notice = r.takeNotice?.()
        if (notice) {
          flash(notice.message)
          // 本机/服务端合并过：趁刚读到版本号，尽快把合并结果写回去。
          if (notice.needsSave) {
            r.save(fixed).catch((e) => {
              console.warn('[词库] 合并结果写回失败', e)
              flash('词库合并结果写回失败；本机改动还在，稍后会自动重试')
            })
          }
        }
        if (import.meta.env?.DEV) {
          const errors = libraryErrors(fixed)
          if (errors.length) console.warn('[词库] 迁移后仍有问题：', errors.slice(0, 10))
        }
        libraryRef.current = fixed
        setLibrary(fixed)
        setLibraryLoad('ok')
        const rawEntries = raw.articleEntries
        const fixedEntries = fixed.articleEntries ?? []
        const entriesDirty = Array.isArray(rawEntries)
          ? fixedEntries !== rawEntries
          : fixedEntries.length > 0
        const dirty =
          !raw ||
          fixed.items.length !== raw.items.length ||
          fixed.items.some((it, i) => it !== raw.items[i]) ||
          entriesDirty
        if (dirty && !notice?.needsSave) {
          r.save(fixed).catch((e) => {
            // 迁移结果没写回去不影响本次使用，但要让用户知道下次打开可能还要再修一遍
            console.warn('[词库] 迁移结果写回失败', e)
            flash('词库已修正，但写回失败；改动可能不会保留到下次打开')
          })
        }
      })
      .catch((e) => {
        // 读失败：**不要**把空库写回去，也别让自动补全动它；必须让用户看见（否则像「生词全没了」）
        console.warn('[词库] 读取失败', e)
        setLibraryLoad('failed')
        flash('词库读取失败：为避免覆盖，本次不会写入；请先导出备份再刷新页面')
      })
    // 申请持久存储，降低 IndexedDB 被浏览器回收的概率
    try {
      void navigator.storage?.persist?.()
    } catch {
      // 老浏览器忽略
    }
  }, [createRepo, flash])

  const persist = useCallback((lib: VocabLibrary) => saver.persist(lib), [saver])
  const persistNow = useCallback((lib: VocabLibrary) => saver.persistNow(lib), [saver])

  // 卸下 / 页面隐藏 / 关闭时把待写的那版刷出去。
  // `pagehide` 比 `beforeunload` 可靠（移动端/被系统回收时也会发）；`visibilitychange`
  // 覆盖「切到别的标签页/切走 App」这种最常见的中断。
  useEffect(() => {
    const flushNow = () => saver.flush()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushNow()
    }
    window.addEventListener('pagehide', flushNow)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flushNow)
      document.removeEventListener('visibilitychange', onVisibility)
      saver.dispose()
    }
  }, [saver])

  return { library, libraryRef, libraryLoad, libraryLoaded, persist, persistNow }
}
