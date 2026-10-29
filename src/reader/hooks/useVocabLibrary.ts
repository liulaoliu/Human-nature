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
 *   - 加载态三态化（pending / ok / failed），failed 时 persist **硬拒绝写入**并提示先导备份；
 *   - 落盘前由仓储追加历史快照，误清后可从快照 / 备份里手工救回（界面不提供一键退版）。
 */
export type LibraryLoadState = 'pending' | 'ok' | 'failed'

export interface UseVocabLibraryParams {
  flash: (msg: string) => void
  /** 换实现用（测试注入假仓储；默认 IndexedDB，隐私模式退回内存） */
  createRepo?: () => VocabRepoPort
}

/** 连续操作的合并窗口：300ms 内多次 persist 只落一次盘。 */
export const PERSIST_DELAY_MS = 300
/** 合并上限：一直有操作时也不能无限往后推（最迟这么久必须落一次盘）。 */
export const PERSIST_MAX_WAIT_MS = 1200
/** 写失败后的重试退避：1s → 2s → 4s …，封顶 15s（页面还开着就一直试）。 */
export const PERSIST_RETRY_BASE_MS = 1000
export const PERSIST_RETRY_MAX_MS = 15_000

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

  /** 待落盘的那一版（合并写：只保留最新）。 */
  const pendingRef = useRef<VocabLibrary | null>(null)
  const timerRef = useRef<number | null>(null)
  /** 本轮待写是什么时候开始的 —— 决定「最迟多久必须落盘」。 */
  const firstPendingAtRef = useRef(0)
  /** 保存串行队列：并发 save 会拿同一个 base 版本号，后一次必然 409。 */
  const chainRef = useRef<Promise<void>>(Promise.resolve())
  /** flush 的稳定句柄（卸载 / 页面隐藏的回调只注册一次）。 */
  const flushRef = useRef<() => void>(() => {})
  /** 连续失败次数：决定退避时长；成功一次就清零。 */
  const retryCountRef = useRef(0)
  /**
   * 显式写入（persistNow）的代号。老版本保存失败回来时如果代号已经变了，
   * 说明用户/导入已经用更新的整库覆盖，绝不能再把老版本放回待写队列。
   */
  const writeGenRef = useRef(0)
  /**
   * 撞过版本冲突：本页词库只读。
   *
   * 冲突代表服务器上已经有别处写的新版本，本页这份是旧的；再写就等于替用户决定
   * 「用旧版覆盖新版」。自动补全每改一次都会 persist，所以必须在这里整页停写，
   * 只更新界面、不再落盘，等用户刷新。仓储层（HybridVocabRepo.conflict）也会拒绝写入。
   */
  const conflictBlockRef = useRef(false)
  /** 组件是否还挂着：卸载后不再起重试定时器。 */
  const aliveRef = useRef(true)
  /** flash 的最新引用：保存回来时组件可能已经重渲染过。 */
  const flashRef = useRef(flash)
  flashRef.current = flash

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

  /**
   * 唯一的写入入口。
   *
   * **合并写**：以前每次 persist 都立刻 `repo.save(整库)` —— 词库 16MB 时，
   * 点一次「加入生词本」＝ 序列化 116ms + 上传 16MB + 服务端两次 gzip（各 277ms），
   * 连点五个词就是五次全量重写。现在：
   *   - 界面照旧**立即**更新（state / libraryRef 同步），只把落盘推迟；
   *   - 300ms 内多次改动合并成一次，写的是「最新那一版」；
   *   - 一直有操作时最长 1200ms 也强制落一次（防饿死）；
   *   - 卸载 / 页面隐藏 / pagehide 时立即 flush，减少「点了没存上」的窗口。
   * 保存串行排队：两次 save 并发会拿同一个 base 版本号，后一次必然 409。
   */
  const persist = useCallback(
    (lib: VocabLibrary) => {
      /** 硬闸：词库没读成功就绝不写（否则空库会覆盖回 IndexedDB，生词全丢）。 */
      if (libraryLoad === 'failed') {
        flash('词库读取出错：为避免覆盖，本次不写入；请先导出备份再刷新页面')
        return
      }
      if (!repo.current) {
        flash('词库还没准备好，请稍后再试')
        return
      }
      libraryRef.current = lib
      setLibrary(lib)
      // 撞过冲突：界面照常更新，但不再落盘（落盘会用旧版覆盖服务端新版）。
      if (conflictBlockRef.current) return
      pendingRef.current = lib

      const now = Date.now()
      if (firstPendingAtRef.current === 0) firstPendingAtRef.current = now
      // 已经有待写的版本，且等太久了：立刻落盘，别让连续操作把写入无限推后
      if (now - firstPendingAtRef.current >= PERSIST_MAX_WAIT_MS) {
        flushRef.current()
        return
      }
      if (timerRef.current != null) clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => flushRef.current(), PERSIST_DELAY_MS)
    },
    [libraryLoad, flash],
  )

  /**
   * 立刻写入指定版本并**等结果**（导入备份用）。
   *
   * `persist` 是给界面用的合并写（延迟 + 失败自动重试），调用方拿不到成败；
   * 导入备份必须在词库真正落盘之后才记「这份文件已导入」，否则 409 / 断网后
   * 用户再导入同一份文件会被去重直接跳过，数据却没进来。
   * 失败会抛给调用方；`library` state 仍然先更新（和 persist 一致）。
   */
  const persistNow = useCallback(
    async (lib: VocabLibrary): Promise<void> => {
      if (libraryLoad === 'failed') {
        flash('词库读取出错：为避免覆盖，本次不写入；请先导出备份再刷新页面')
        throw new Error('词库读取出错')
      }
      const repoNow = repo.current
      if (!repoNow) {
        flash('词库还没准备好，请稍后再试')
        throw new Error('词库还没准备好')
      }
      if (conflictBlockRef.current) {
        flash('词库已被别处更新，本页停止写入；请刷新页面后再导入/保存')
        throw new Error('词库冲突未解决')
      }
      // 导入的是合并后的最新版：取消还没落盘的旧版本，别让它随后把新版盖回去。
      writeGenRef.current += 1
      if (timerRef.current != null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      pendingRef.current = null
      firstPendingAtRef.current = 0
      libraryRef.current = lib
      setLibrary(lib)

      // 串行排队；链本身永远不 reject，失败只抛给本次调用方，后面的版本还能继续写。
      const task = chainRef.current.then(() => repoNow.save(lib))
      chainRef.current = task.then(
        () => undefined,
        () => undefined,
      )
      await task
      retryCountRef.current = 0
    },
    [libraryLoad, flash],
  )

  /** 立即把待写的那版落盘（没有待写就什么也不做）。 */
  const flush = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    firstPendingAtRef.current = 0
    const lib = pendingRef.current
    pendingRef.current = null
    if (!lib || !repo.current) return
    const repoNow = repo.current
    const gen = writeGenRef.current
    // 串行化：上一次还没回来就排队，避免并发 save 互相撞版本号
    chainRef.current = chainRef.current.then(async () => {
      try {
        await repoNow.save(lib)
        retryCountRef.current = 0
      } catch (e) {
        // 版本冲突和「存不上」是两件事：冲突说明别处已经写过，**这次改动根本没落盘**，
        // 必须让用户知道（否则他以为保存成功了，实际刷新就没了）。
        if (e instanceof StoreConflictError) {
          // 不自动重试：重试就等于替用户决定「用本页覆盖服务器」。
          // 而且要把本页整页停写 —— 否则下一次自动保存会带着刚更新的版本号把旧词库写上去。
          conflictBlockRef.current = true
          retryCountRef.current = 0
          flashRef.current(
            `词库在别的页面被改过（服务器现有 ${e.count} 条），本页已停止写入以免覆盖新版；请刷新页面后再改`,
          )
          return
        }
        // 这版已经被更新的一次显式写入（导入备份）取代：别把老版本放回队列。
        if (writeGenRef.current !== gen) return
        console.warn('[词库] 保存失败', e)
        flashRef.current('词库保存失败：界面已更新，但可能没落盘；正在自动重试，也可先导出备份')
        // 失败的那版放回待写队列；如果保存期间又来了更新的版本，以新版为准。
        if (pendingRef.current == null) pendingRef.current = lib
        if (firstPendingAtRef.current === 0) firstPendingAtRef.current = Date.now()
        if (!aliveRef.current) return
        // 已有更新版本安排的合并写定时器就让它先跑，不额外插队。
        if (timerRef.current != null) return
        const delay = Math.min(
          PERSIST_RETRY_BASE_MS * 2 ** retryCountRef.current,
          PERSIST_RETRY_MAX_MS,
        )
        retryCountRef.current += 1
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null
          flushRef.current()
        }, delay)
      }
    })
  }, [])
  // flush 要能被「卸载 / 页面隐藏」这些只跑一次的回调拿到最新版本
  flushRef.current = flush

  // 卸下 / 页面隐藏 / 关闭时把待写的那版刷出去。
  // `pagehide` 比 `beforeunload` 可靠（移动端/被系统回收时也会发）；`visibilitychange`
  // 覆盖「切到别的标签页/切走 App」这种最常见的中断。
  useEffect(() => {
    const flushNow = () => flushRef.current()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushNow()
    }
    window.addEventListener('pagehide', flushNow)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      aliveRef.current = false
      window.removeEventListener('pagehide', flushNow)
      document.removeEventListener('visibilitychange', onVisibility)
      flushNow()
    }
  }, [])

  return { library, libraryRef, libraryLoad, libraryLoaded, persist, persistNow }
}
