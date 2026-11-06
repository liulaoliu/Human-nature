import type { useProductionSession } from '../hooks/useProductionSession'

type ProductionModel = ReturnType<typeof useProductionSession>

export interface ProductionDoneViewProps {
  model: Pick<ProductionModel, 'restart' | 'close'>
}

/** 收工：再来一组 / 回阅读。 */
export default function ProductionDoneView({ model }: ProductionDoneViewProps) {
  return (
    <div className="production-body production-done">
      <b>这一组收工了 🐄</b>
      <p className="muted">已经把草嚼成奶了。下一组可以换模式 / 主题，或者把今天的句子再说一遍。</p>
      <div className="bar">
        <button className="primary" onClick={model.restart}>
          再来一组
        </button>
        <button onClick={model.close}>回到阅读</button>
      </div>
    </div>
  )
}
