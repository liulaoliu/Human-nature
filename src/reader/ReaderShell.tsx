import type { MouseEvent, ReactNode, RefObject } from 'react'
import FishLayer from '../ui/FishLayer'

/**
 * 阅读页外壳：只负责**布局**（页级 class / 背景鱼群 / 正文区 / 右侧栏 / toast），
 * 三块内容由调用方以 slot 传入：
 *   - `toolbar`：精读工具栏（只有阅读视图才渲染）；
 *   - `children`：正文区里的练习面板与阅读正文；
 *   - `sidebar`：右侧栏（`ReaderSidebar`）。
 *
 * 抽出来的目的：`ReaderApp` 只拼数据与 slot，不再关心外层 DOM 与鼠标事件绑定。
 */
export interface ReaderShellProps {
  fontSize: string
  bold: boolean
  serif: boolean
  /** 考试 / 快刷 / 听写 / 听力进行时：整页换 exam 皮肤。 */
  examActive: boolean
  /** 背单词进行时：整页换 studying 皮肤。 */
  studying: boolean
  /** 右侧栏当前 Tab（决定 `tab-*` class）。 */
  sideTab: string
  sideRef: RefObject<HTMLElement>
  onMouseDown: (e: MouseEvent<HTMLElement>) => void
  onMouseUp: (e: MouseEvent<HTMLElement>) => void
  onContextMenu: (e: MouseEvent<HTMLElement>) => void
  toolbar?: ReactNode
  children: ReactNode
  sidebar: ReactNode
  toast: string
}

export default function ReaderShell({
  fontSize,
  bold,
  serif,
  examActive,
  studying,
  sideTab,
  sideRef,
  onMouseDown,
  onMouseUp,
  onContextMenu,
  toolbar,
  children,
  sidebar,
  toast,
}: ReaderShellProps) {
  const cls =
    `reader size-${fontSize}` +
    (bold ? ' weight-bold' : '') +
    (serif ? ' font-serif' : '') +
    (examActive ? ' exam' : '') +
    (studying ? ' studying' : '')

  return (
    <div className={cls}>
      <FishLayer pageKey="reader" />
      <main className="reader-main" onMouseDown={onMouseDown} onMouseUp={onMouseUp} onContextMenu={onContextMenu}>
        {toolbar}
        {children}
      </main>

      <aside className={'reader-side tab-' + sideTab} ref={sideRef}>
        {sidebar}
      </aside>

      {/* 提示条要能被读屏播报：保存失败 / 恢复词库这类结果只有这一处可见反馈 */}
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  )
}
