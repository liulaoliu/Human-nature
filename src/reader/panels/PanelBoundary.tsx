import { Component, type ErrorInfo, type ReactNode } from 'react'

export interface PanelBoundaryProps {
  /** 面板名（用在提示里，例如「速读」）。 */
  name: string
  /** 关掉这个面板：走路由的 replace，不会把整页带走。 */
  onClose: () => void
  /** 重试方式（测试注入）；默认整页重载——chunk 加载失败只能重新拉一次。 */
  onRetry?: () => void
  children: ReactNode
}

interface PanelBoundaryState {
  failed: boolean
}

/**
 * 懒加载面板的**局部**错误边界。
 *
 * 以前 `Suspense` 只处理 loading：某个 panel chunk 加载失败或渲染抛错时，
 * 异常会冒到整棵 React 树，阅读页直接白屏，用户连「关掉这个面板」都点不到。
 * 现在每个面板各包一层：失败只换掉这一块，给「重试 / 关闭」两个出口。
 */
export default class PanelBoundary extends Component<PanelBoundaryProps, PanelBoundaryState> {
  state: PanelBoundaryState = { failed: false }

  static getDerivedStateFromError(): PanelBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[面板] ${this.props.name}加载/渲染失败`, error, info.componentStack)
  }

  private retry = () => {
    if (this.props.onRetry) {
      this.setState({ failed: false })
      this.props.onRetry()
      return
    }
    if (typeof window !== 'undefined') window.location.reload()
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="panel-error" role="alert">
        <strong>{this.props.name}加载失败</strong>
        <p className="muted">这一块没有把整页拖垮。可以重试，或先关掉继续读。</p>
        <div className="bar">
          <button className="primary" onClick={this.retry}>
            重试
          </button>
          <button onClick={this.props.onClose}>关闭</button>
        </div>
      </div>
    )
  }
}
