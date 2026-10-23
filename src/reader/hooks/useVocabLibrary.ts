import { useCallback, useEffect, useRef, useState } from 'react'
import type { VocabLibrary } from '../../types/document'
import type { VocabRepoPort } from '../../core/ports'
import { createLibrary } from '../../core/vocab'
import { migrateLibrary } from '../../core/migrations'
import { libraryErrors } from '../../core/libraryValidate'
import { createVocabRepo } from '../../adapters/vocabRepo'
import { StoreConflictError } from '../../adapters/storeApi'

/**
 * 词库的**持久化接线**：读回来 → 修数据 → 对外提供「写一次」的 persist。
 *
 * 为什么单独一个 hook：
 *   1. 它是「谁在什么时候写词库」这件事故高发区的唯一入口（读失败绝不写、写前留备份）；
 *   2. 抽出来后可以用假仓储直接测（见 useVocabLibrary.test.tsx），不用挂整个 ReaderApp；
 *   3. ReaderApp 只拿结果，不再自己管 repo/ref/加载态。
 *
 * 事故背景（真实）：IndexedDB 读取失败时拿到的是**空库**，而当时的代码把加载态直接置 true，
 * 于是自动补全把「空库 + 语言点」写了回去 —— 生词全丢。现在：
 *   - 加载态三态化（pending / ok / failed），failed 时 persist **硬拒绝写入**并提示恢复；
 *   - 每次覆盖前由仓储留一份「上一版」（只留更大的那份），提供 restorePrev 一键退回。
 */
export type LibraryLoadState = 'pending' | 'ok' | 'failed'

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
  /** 退回「覆盖前那一版」（防误清 / 读失败事故） */
  restorePrev: () => Promise<void>
}

export function useVocabLibrary({ flash, createRepo = createVocabRepo }: UseVocabLibraryParams): UseVocabLibraryResult {
  const [library, setLibrary] = useState<VocabLibrary>(() => createLibrary())
  const [libraryLoad, setLibraryLoad] = useState<LibraryLoadState>('pending')
  const repo = useRef<VocabRepoPort | null>(null)
  const libraryRef = useRef(library)
  libraryRef.current = library
  const libraryLoaded = libraryLoad === 'ok'

  // 读回词库：修数据（去重 / 语法标记 / 早先版本误标的类型），修过就写回去
  useEffect(() => {
    const r = createRepo()
    repo.current = r
    r.load()
      .then((raw) => {
        // 老数据兼容 / 清洗 / 去重**统一收口**在 core/migrations；顺手自检不变量
        const fixed = migrateLibrary(raw)
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
        if (dirty) {
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
        flash('词库读取失败：为避免覆盖，本次不会写入；可点「恢复上一版词库」或先导出备份')
      })
    // 申请持久存储，降低 IndexedDB 被浏览器回收的概率
    try {
      void navigator.storage?.persist?.()
    } catch {
      // 老浏览器忽略
    }
  }, [createRepo, flash])

  const persist = useCallback(
    (lib: VocabLibrary) => {
      /** 硬闸：词库没读成功就绝不写（否则空库会覆盖回 IndexedDB，生词全丢）。 */
      if (libraryLoad === 'failed') {
        flash('词库读取出错：为避免覆盖，本次不写入（可点「恢复上一版词库」试试）')
        return
      }
      if (!repo.current) {
        flash('词库还没准备好，请稍后再试')
        return
      }
      libraryRef.current = lib
      setLibrary(lib)
      repo.current.save(lib).catch((e) => {
        // 版本冲突和「存不上」是两件事：冲突说明别处已经写过，**这次改动根本没落盘**，
        // 必须让用户知道（否则他以为保存成功了，实际刷新就没了）。
        if (e instanceof StoreConflictError) {
          flash(`词库在别的页面被改过（服务器现有 ${e.count} 条），这次改动没保存；刷新后再改，或再存一次用本页覆盖`)
          return
        }
        console.warn('[词库] 保存失败', e)
        flash('词库保存失败：界面已更新，但可能没落盘；请稍后重试或导出备份')
      })
    },
    [libraryLoad, flash],
  )

  const restorePrev = useCallback(async () => {
    const prev = await repo.current?.loadPrev?.()
    if (!prev?.items.length) {
      flash('没有可恢复的上一版')
      return
    }
    libraryRef.current = prev
    setLibrary(prev)
    try {
      await repo.current?.save(prev)
    } catch (e) {
      console.warn('[词库] 恢复上一版后写回失败', e)
      flash('已恢复上一版词库，但写回失败；请先导出备份再刷新')
    }
    setLibraryLoad('ok')
    flash(`已恢复上一版词库：${prev.items.length} 条`)
  }, [flash])

  return { library, libraryRef, libraryLoad, libraryLoaded, persist, restorePrev }
}
