import { useEffect, useRef, useState, type ReactNode } from 'react'
import { pickAudioFile, supportsAudioPicker } from '../adapters/audioPick'
import type { Take } from '../core/ports'
import mascotBig from '../../assets/imgs/big.png'

/**
 * 跟读页里的小零件：空状态、备份条、录音导出、时间格式化。
 * 从 `App.tsx` 抽出来 —— 那边是页面装配，这些跟页面状态没关系。
 */

/**
 * 选音频：支持 File System Access 时改用能「记住上次目录」的选框（并阻止原生 input 弹出），
 * 否则回退普通 input（浏览器一般也会记住上次目录）。
 */
export function interceptAudioPick(
  e: { preventDefault: () => void },
  load: (f: File) => void,
): void {
  if (!supportsAudioPicker()) return
  e.preventDefault()
  void pickAudioFile().then((f) => {
    if (f) load(f)
  })
}

export function Empty({ onPick, backup }: { onPick: (f: File) => void; backup?: ReactNode }) {
  return (
    <div className="empty">
      <img className="empty-mascot" src={mascotBig} alt="" />
      <h1>跟读练习</h1>
      <p>选一个音频文件（mp3 / wav），自动切成块，然后一块一块听、跟读、对比。</p>
      <label className="big-btn">
        选择音频
        <input
          type="file"
          accept="audio/*"
          onClick={(e) => interceptAudioPick(e, onPick)}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onPick(f)
          }}
        />
      </label>
      <a className="navlink accent empty-nav" href="./reader.html" title="打开 学吧老哥 / 生词本">
        学吧老哥 · 生词本 <span className="arrow">→</span>
      </a>
      <p className="tip">
        浏览器不给 <code>file://</code> 页面麦克风权限。如果点录音没反应，在项目目录跑{' '}
        <code>npm run dev</code>，然后打开终端里给的 <code>http://localhost</code> 地址。
      </p>
      {backup && <div className="empty-backup">{backup}</div>}
    </div>
  )
}

/** 备份的导出/导入 + 存入项目。放 header 和空状态两处用。 */
export function BackupBar({
  onExport,
  onImport,
  onSaveProject,
}: {
  onExport: () => void
  onImport: (f: File) => void
  onSaveProject: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <button
        className="ghost sm"
        onClick={onExport}
        title="把本机的校准（选字锚点等）和改过的正文下载成一个 json，换电脑时带走"
      >
        导出备份
      </button>
      <button
        className="ghost sm"
        onClick={() => ref.current?.click()}
        title="从备份 json 恢复（会覆盖同名文章的进度）"
      >
        导入备份
      </button>
      <button
        className="ghost sm"
        onClick={onSaveProject}
        title="写入项目的 public/shadowing-state.json（npm run dev 或「启动服务」模式下可用）"
      >
        存入项目
      </button>
      <input
        ref={ref}
        type="file"
        accept="application/json,.json"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onImport(f)
          e.target.value = ''
        }}
      />
    </>
  )
}

/**
 * 导出一条录音的下载链接。
 *
 * object URL 只能手动 revoke。之前这个 `<a href={URL.createObjectURL(...)}>` 直接写在
 * 渲染里，于是**每次重渲染都新建一个 URL 且从不释放**——而录音时电平表在 60fps 触发
 * 整页重渲染，一次跟读能漏出几百个。改成每个 take 只建一个，换录音/卸载时释放。
 */
export function TakeExport({ take, fileName }: { take: Take; fileName: string }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const u = URL.createObjectURL(take.blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [take.blob])
  if (!url) return <span className="pending">导出</span>
  return (
    <a href={url} download={fileName}>
      导出
    </a>
  )
}

/** 当前块录过的音：逐条导出 / 删。没录音时整块不渲染。 */
export function TakesList({
  takes,
  chunkNumber,
  onRemove,
}: {
  takes: Take[]
  /** 第几块（1 起算），拼下载文件名用 */
  chunkNumber: number
  onRemove: (id: string) => void
}) {
  if (takes.length === 0) return null
  return (
    <ul className="takes">
      {takes.map((t, i) => (
        <li key={t.id}>
          <span>
            第 {i + 1} 条 · {t.durationSec.toFixed(1)}s
          </span>
          <TakeExport take={t} fileName={`${chunkNumber}-${i + 1}.${extOf(t.mimeType)}`} />
          <button className="ghost sm" onClick={() => onRemove(t.id)}>
            删
          </button>
        </li>
      ))}
    </ul>
  )
}

/** 秒 → m:ss（列表里的时间点，最长也不会到小时） */
export function fmt(sec: number) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** 录音 blob 的 MIME → 下载后缀 */
export function extOf(mime: string) {
  return mime.includes('mp4') ? 'm4a' : 'webm'
}
