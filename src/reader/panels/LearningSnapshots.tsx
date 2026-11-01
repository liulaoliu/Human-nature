import { useCallback, useState, type SyntheticEvent } from 'react'
import {
  formatSnapshotAt,
  formatSnapshotBytes,
  snapshotReasonLabel,
  type LearningSnapshotMeta,
} from '../../core/learningSnapshots'
import {
  createLearningSnapshot,
  listLearningSnapshots,
  restoreLearningSnapshot,
} from '../../adapters/learningSnapshots'

export interface LearningSnapshotsProps {
  /** 恢复成功后怎么回到新数据；默认刷新整页（最省事，也不会漏掉别的 hook）。 */
  onRestored?: () => void
  /** 测试注入用；默认 `window.confirm`。 */
  confirm?: (message: string) => boolean
}

function defaultRestored(): void {
  window.location.reload()
}

/**
 * 学习记录的版本快照：列表 / 手动拍一张 / 恢复。
 *
 * 服务端自动快照是**节流**的（正常保存 10 分钟一张，覆盖/重建/恢复前额外一张），
 * 这里只做低频的手动兜底。默认折叠，不占侧栏空间，也不在挂载时发请求。
 */
export default function LearningSnapshots({
  onRestored = defaultRestored,
  confirm = (message) => window.confirm(message),
}: LearningSnapshotsProps) {
  const [items, setItems] = useState<LearningSnapshotMeta[] | null>(null)
  const [picked, setPicked] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setBusy(true)
    setMsg('')
    try {
      const res = await listLearningSnapshots()
      setItems(res.snapshots)
      setPicked((cur) => (res.snapshots.some((s) => s.at === cur) ? cur : ''))
      if (res.dropped) setMsg(`已丢弃 ${res.dropped} 条坏快照记录`)
    } catch {
      setItems([])
      setMsg('本地存储服务不可用，快照功能需要 `npm run dev` / `npm run serve`')
    } finally {
      setBusy(false)
    }
  }, [])

  const onToggle = (e: SyntheticEvent<HTMLDetailsElement>) => {
    if (e.currentTarget.open) void load()
  }
  const create = async () => {
    setBusy(true)
    try {
      const at = await createLearningSnapshot()
      await load()
      setMsg(at ? `已保存 ${formatSnapshotAt(at)}` : '没有新增快照（内容未变或还没有学习记录）')
    } catch {
      setMsg('拍快照失败：本地存储服务不可用')
    } finally {
      setBusy(false)
    }
  }

  const restore = async () => {
    if (!picked) return
    if (!confirm(`恢复到 ${formatSnapshotAt(picked)} 的学习记录？当前记录会先自动拍一张。`)) return
    setBusy(true)
    try {
      await restoreLearningSnapshot(picked)
      setMsg('已恢复，正在重新加载…')
      onRestored()
    } catch {
      setMsg('恢复失败：本地存储服务不可用')
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="snap-box" onToggle={onToggle}>
      <summary>学习记录快照（自动保留最近 12 版）</summary>
      <div className="snap-body">
        <button type="button" onClick={() => void create()} disabled={busy}>
          现在拍一张
        </button>
        <select
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          disabled={busy || !items?.length}
          aria-label="选择要恢复的学习快照"
        >
          <option value="">
            {items === null ? '加载中…' : items.length ? '选择要恢复的版本…' : '还没有快照'}
          </option>
          {items?.map((s) => (
            <option key={s.at} value={s.at}>
              {formatSnapshotAt(s.at)} · {snapshotReasonLabel(s.reason)} · {formatSnapshotBytes(s.bytes)}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void restore()} disabled={busy || !picked}>
          恢复
        </button>
        {msg && <span className="snap-msg">{msg}</span>}
      </div>
    </details>
  )
}
