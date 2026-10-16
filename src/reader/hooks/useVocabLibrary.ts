import { useCallback, useEffect, useRef, useState } from 'react'
import type { VocabLibrary } from '../../types/document'
import type { VocabRepoPort } from '../../core/ports'
import { createLibrary, dedupeLibrary, normalizeGrammarMarks } from '../../core/vocab'
import { rescueLibrary, type RescueRecords } from '../../core/libraryRescue'
import { readJson } from '../storage'
import { repairLanguageKinds } from '../../core/langPoints'
import { createVocabRepo } from '../../adapters/vocabRepo'

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
  /** 从本机其它记录（待选清单 / 错题本）把词条找回来 */
  rescueFromLocalRecords: () => void
}

/** 本机还留着词的几处记录（救援素材）。 */
export function readRescueRecords(): RescueRecords {
  const batch = readJson<RescueRecords['batch']>('reader:batch', {})
  const mistakes = readJson<{ itemId?: string; label?: string }[]>('reader:mistakes', [])
  const mistakeWords = (mistakes ?? [])
    .flatMap((m) => [m?.itemId ?? '', m?.label ?? ''])
    .filter((s) => !!s && /^[A-Za-z][A-Za-z' -]*$/.test(s))
  return { batch: batch ?? {}, mistakeWords }
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
      .then((lib) => {
        const fixed = normalizeGrammarMarks(repairLanguageKinds(dedupeLibrary(lib)))
        libraryRef.current = fixed
        setLibrary(fixed)
        setLibraryLoad('ok')
        const dirty = fixed.items.length !== lib.items.length || fixed.items.some((it, i) => it !== lib.items[i])
        if (dirty) r.save(fixed).catch(() => {})
      })
      .catch(() => {
        // 读失败：**不要**把空库写回去，也别让自动补全动它
        setLibraryLoad('failed')
      })
    // 申请持久存储，降低 IndexedDB 被浏览器回收的概率
    try {
      void navigator.storage?.persist?.()
    } catch {
      // 老浏览器忽略
    }
  }, [createRepo])

  const persist = useCallback(
    (lib: VocabLibrary) => {
      /** 硬闸：词库没读成功就绝不写（否则空库会覆盖回 IndexedDB，生词全丢）。 */
      if (libraryLoad === 'failed') {
        flash('词库读取出错：为避免覆盖，本次不写入（可点「恢复上一版词库」试试）')
        return
      }
      libraryRef.current = lib
      setLibrary(lib)
      repo.current?.save(lib).catch(() => {})
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
    repo.current?.save(prev).catch(() => {})
    setLibraryLoad('ok')
    flash(`已恢复上一版词库：${prev.items.length} 条`)
  }, [flash])

  const rescueFromLocalRecords = useCallback(() => {
    if (libraryLoad === 'failed') {
      flash('词库没读出来：先「恢复上一版词库」或刷新，再试找回')
      return
    }
    const records = readRescueRecords()
    const out = rescueLibrary(libraryRef.current, records)
    if (!out.added) {
      flash(out.found ? `素材里 ${out.found} 个词都已在词库里` : '本机没有可找回的记录（待选清单 / 错题本是空的）')
      return
    }
    persist(out.library)
    flash(`已从本机记录找回 ${out.added} 个词条（释义可用「补齐生词本」本地补）`)
  }, [libraryLoad, flash, persist])

  return { library, libraryRef, libraryLoad, libraryLoaded, persist, restorePrev, rescueFromLocalRecords }
}
