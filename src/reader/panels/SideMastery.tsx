import type { ArticleMastery } from '../../core/mastery'

export interface SideMasteryProps {
  mastery: ArticleMastery
  onStartArticle: () => void
  onStartVocab: () => void
}

/** 本篇掌握度：综合分 + 各维度明细 + 下一步。 */
export default function SideMastery({ mastery: m, onStartArticle, onStartVocab }: SideMasteryProps) {
  const g = m.grade === '很熟' ? '4' : m.grade === '熟' ? '3' : m.grade === '半熟' ? '2' : '1'
  return (
    <div className="side-sec" data-sec="mastery">
      <div className="section-title">掌握度 · 本篇</div>
      <div className="mastery-score">
        <div className="mastery-num">{m.score}</div>
        <div className={'mastery-grade g' + g}>{m.grade}</div>
      </div>
      {!m.enough && <div className="muted mastery-tip">技能数据不足，先做一轮考试 / 听写 / 理解会更准。</div>}
      <div className="mastery-dims">
        {m.dimensions.map((d) => (
          <div className="mastery-dim" key={d.key}>
            <div className="mastery-dim-row">
              <span>{d.label}</span>
              <b>{d.score}%</b>
            </div>
            <div className="mastery-bar">
              <div style={{ width: `${d.score}%` }} />
            </div>
            <div className="muted mastery-detail">{d.detail}</div>
          </div>
        ))}
      </div>
      <div className="mastery-next">下一步：{m.next}</div>
      <div className="bar">
        <button className="primary" onClick={onStartArticle} title="英译中 / 中译英 / 功能词填空 / 句子排序 / 结构语法">
          文章测验
        </button>
        <button onClick={onStartVocab} title="按到期 / 未掌握背单词">
          背单词
        </button>
      </div>
    </div>
  )
}
