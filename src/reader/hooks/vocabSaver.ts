import { StoreConflictError } from '../../adapters/storeApi'
import type { VocabRepoPort } from '../../core/ports'
import type { VocabLibrary } from '../../types/document'

/**
 * 词库的「落盘引擎」：合并写 / 串行队列 / 失败退避 / 冲突停写。
 *
 * 为什么从 React 里拆出来：
 *   1. 这些规则是纯状态机，不需要 React —— 拆出来就能直接测每一条分支，
 *      不必等 hook 的定时器；
 *   2. `useVocabLibrary` 只剩「读回来 + 把状态给界面」，职责变单一；
 *   3. 想换存储（IndexedDB / SQLite / 内存）时，动的是 repo，不是这段。
 *
 * 规则来源（都是踩出来的）：
 *   - 词库以前 16MB，点一次「加入生词本」就全量重写一次；现在 300ms 内合并、最迟 1200ms 落一次；
 *   - 并发 save 会拿同一个 base 版本号，后一次必然 409 —— 所以必须串行排队；
 *   - 撞了 409 说明别处已经写过，本页这份是旧的：**整页停写**，别替用户决定用旧版覆盖新版；
 *   - 读失败（idb 被浏览器回收）拿到的是空库，绝不能写回去 —— failed 时 persist 硬拒绝。
 */

/** 连续操作的合并窗口：300ms 内多次 persist 只落一次盘。 */
export const PERSIST_DELAY_MS = 300
/** 合并上限：一直有操作时也不能无限往后推（最迟这么久必须落一次盘）。 */
export const PERSIST_MAX_WAIT_MS = 1200
/** 写失败后的重试退避：1s → 2s → 4s …，封顶 15s（页面还开着就一直试）。 */
export const PERSIST_RETRY_BASE_MS = 1000
export const PERSIST_RETRY_MAX_MS = 15_000

export type LibraryLoadState = 'pending' | 'ok' | 'failed'

const FAILED_MSG = '词库读取出错：为避免覆盖，本次不写入；请先导出备份再刷新页面'

export interface VocabSaverDeps {
  /** 当前仓储；读成功前是 null。 */
  repo: () => VocabRepoPort | null
  /** 词库加载态：`failed` 时一律拒写。 */
  loadState: () => LibraryLoadState
  /** 把最新词库同步给界面（state + ref 由调用方负责）。 */
  apply: (lib: VocabLibrary) => void
  flash: (msg: string) => void
}

export interface VocabSaver {
  persist(lib: VocabLibrary): void
  persistNow(lib: VocabLibrary): Promise<void>
  flush(): void
  dispose(): void
}

export function createVocabSaver({ repo, loadState, apply, flash }: VocabSaverDeps): VocabSaver {
  /** 待落盘的那一版（合并写：只保留最新）。 */
  let pending: VocabLibrary | null = null
  let timer: number | null = null
  /** 本轮待写是什么时候开始的 —— 决定「最迟多久必须落盘」。 */
  let firstPendingAt = 0
  /** 保存串行队列：并发 save 会拿同一个 base 版本号，后一次必然 409。 */
  let chain: Promise<void> = Promise.resolve()
  /** 连续失败次数：决定退避时长；成功一次就清零。 */
  let retryCount = 0
  /**
   * 显式写入（persistNow）的代号。老版本保存失败回来时如果代号已经变了，
   * 说明用户/导入已经用更新的整库覆盖，绝不能再把老版本放回待写队列。
   */
  let writeGen = 0
  /**
   * 撞过版本冲突：本页词库只读。
   *
   * 冲突代表服务器上已经有别处写的新版本，本页这份是旧的；再写就等于替用户决定
   * 「用旧版覆盖新版」。自动补全每改一次都会 persist，所以必须在这里整页停写，
   * 只更新界面、不再落盘，等用户刷新。仓储层（HybridVocabRepo.conflict）也会拒绝写入。
   */
  let conflictBlocked = false
  /** 组件是否还挂着：卸载后不再起重试定时器。 */
  let alive = true

  function clearTimer(): void {
    if (timer != null) {
      clearTimeout(timer)
      timer = null
    }
  }

  /**
   * 唯一的写入入口。
   *
   * 界面**立即**更新（apply 同步），只把落盘推迟：
   * 300ms 内多次改动合并成一次、写的是「最新那一版」；一直有操作时最长 1200ms 也强制落一次。
   */
  function persist(lib: VocabLibrary): void {
    /** 硬闸：词库没读成功就绝不写（否则空库会覆盖回 IndexedDB，生词全丢）。 */
    if (loadState() === 'failed') {
      flash(FAILED_MSG)
      return
    }
    if (!repo()) {
      flash('词库还没准备好，请稍后再试')
      return
    }
    apply(lib)
    // 撞过冲突：界面照常更新，但不再落盘（落盘会用旧版覆盖服务端新版）。
    if (conflictBlocked) return
    pending = lib

    const now = Date.now()
    if (firstPendingAt === 0) firstPendingAt = now
    // 已经有待写的版本，且等太久了：立刻落盘，别让连续操作把写入无限推后
    if (now - firstPendingAt >= PERSIST_MAX_WAIT_MS) {
      flush()
      return
    }
    clearTimer()
    timer = window.setTimeout(flush, PERSIST_DELAY_MS)
  }

  /**
   * 立即把待写的那版落盘（没有待写就什么也不做）。
   *
   * 串行化：上一次还没回来就排队，否则并发 save 拿同一个 base 版本号，后一次必然 409。
   */
  function flush(): void {
    clearTimer()
    firstPendingAt = 0
    const lib = pending
    pending = null
    const repoNow = repo()
    if (!lib || !repoNow) return
    const gen = writeGen
    chain = chain.then(async () => {
      try {
        await repoNow.save(lib)
        retryCount = 0
      } catch (e) {
        // 版本冲突和「存不上」是两件事：冲突说明别处已经写过，**这次改动根本没落盘**，
        // 必须让用户知道（否则他以为保存成功了，实际刷新就没了）。
        if (e instanceof StoreConflictError) {
          // 不自动重试：重试就等于替用户决定「用本页覆盖服务器」。
          // 而且要把本页整页停写 —— 否则下一次自动保存会带着刚更新的版本号把旧词库写上去。
          conflictBlocked = true
          retryCount = 0
          flash(
            `词库在别的页面被改过（服务器现有 ${e.count} 条），本页已停止写入以免覆盖新版；请刷新页面后再改`,
          )
          return
        }
        // 这版已经被更新的一次显式写入（导入备份）取代：别把老版本放回队列。
        if (writeGen !== gen) return
        console.warn('[词库] 保存失败', e)
        flash('词库保存失败：界面已更新，但可能没落盘；正在自动重试，也可先导出备份')
        // 失败的那版放回待写队列；如果保存期间又来了更新的版本，以新版为准。
        if (pending == null) pending = lib
        if (firstPendingAt === 0) firstPendingAt = Date.now()
        if (!alive) return
        // 已有更新版本安排的合并写定时器就让它先跑，不额外插队。
        if (timer != null) return
        const delay = Math.min(PERSIST_RETRY_BASE_MS * 2 ** retryCount, PERSIST_RETRY_MAX_MS)
        retryCount += 1
        timer = window.setTimeout(() => {
          timer = null
          flush()
        }, delay)
      }
    })
  }

  /**
   * 立刻写入指定版本并**等结果**（导入备份用）。
   *
   * `persist` 是给界面用的合并写（延迟 + 失败自动重试），调用方拿不到成败；
   * 导入备份必须在词库真正落盘之后才记「这份文件已导入」，否则 409 / 断网后
   * 用户再导入同一份文件会被去重直接跳过，数据却没进来。
   * 失败会抛给调用方；界面 state 仍然先更新（和 persist 一致）。
   */
  async function persistNow(lib: VocabLibrary): Promise<void> {
    if (loadState() === 'failed') {
      flash(FAILED_MSG)
      throw new Error('词库读取出错')
    }
    const repoNow = repo()
    if (!repoNow) {
      flash('词库还没准备好，请稍后再试')
      throw new Error('词库还没准备好')
    }
    if (conflictBlocked) {
      flash('词库已被别处更新，本页停止写入；请刷新页面后再导入/保存')
      throw new Error('词库冲突未解决')
    }
    // 导入的是合并后的最新版：取消还没落盘的旧版本，别让它随后把新版盖回去。
    writeGen += 1
    clearTimer()
    pending = null
    firstPendingAt = 0
    apply(lib)

    // 串行排队；链本身永远不 reject，失败只抛给本次调用方，后面的版本还能继续写。
    const task = chain.then(() => repoNow.save(lib))
    chain = task.then(
      () => undefined,
      () => undefined,
    )
    await task
    retryCount = 0
  }

  /** 卸载：把待写的那版刷出去，并停止后续重试。 */
  function dispose(): void {
    alive = false
    flush()
  }

  return { persist, persistNow, flush, dispose }
}
