import type { useProductionSession } from '../hooks/useProductionSession'
import GoldenFeedback from './golden/GoldenFeedback'
import ProductionFollowUp from './ProductionFollowUp'

export interface ProductionReviewProps {
  model: ReturnType<typeof useProductionSession>
}

/** 批改后的复盘区：参考译文 / 分数 / 目标块 / 重写或下一题 / 追问。 */
export default function ProductionReview({ model }: ProductionReviewProps) {
  if (!model.feedback) return null
  return (
    <div className="production-review">
      {model.current?.reference && (
        <div className="production-reference">
          <b>参考译文：</b>
          {model.current.reference}
        </div>
      )}
      <GoldenFeedback feedback={model.feedback} />
      {model.hits.length > 0 && (
        <div className="production-hits">
          <b>目标块：</b>
          {model.hits.map((h) => (
            <span key={h.id} className={h.used ? 'ok' : 'bad'}>
              {h.text}：{h.used ? '用上了' : '没用上'}
              {h.meaning ? `（${h.meaning}）` : ''}{' '}
              <button
                onClick={() => model.setHitUsed(h.id, !h.used)}
                title="本地词形匹配漏判时手工纠正"
              >
                {h.used ? '标为没用' : '标为用了'}
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="bar">
        {model.round < 2 ? (
          <button className="primary" onClick={model.rewrite}>
            按批改意见重写一版
          </button>
        ) : (
          <button className="primary" onClick={model.next}>
            下一题
          </button>
        )}
        <button onClick={model.skip} title="不继续重写，直接进入下一题">
          跳过这题
        </button>
      </div>
      <ProductionFollowUp
        items={model.followUp.items}
        asking={model.followUp.asking}
        error={model.followUp.error}
        onAsk={model.followUp.ask}
      />
    </div>
  )
}
