import type { DrillWarmupCard } from '../hooks/useQuizSession'

export interface DrillWarmupProps {
  title: string
  kind: 'memory' | 'chunk'
  cards: DrillWarmupCard[]
  /** 看完，开始拷打 */
  onStart: () => void
  /** 本轮不考 */
  onCancel: () => void
}

/**
 * 拷打前的「先学一遍」：把这轮要考的词连同释义、词块摊开看一遍，再闭卷。
 *
 * 为什么要有这一步：记忆拷打/词块拷打是**闭卷回忆**。直接上来就考，
 * 第一次见到的词只能靠猜 —— 猜错记进错题本，等于把「没见过」当成「没记住」，
 * 词块更是连「该有哪些搭配」都不知道。先过一遍再看，分数才反映记忆。
 */
export default function DrillWarmup({ title, kind, cards, onStart, onCancel }: DrillWarmupProps) {
  return (
    <div className="study drill-warm">
      <div className="bar study-bar">
        <button onClick={onCancel} title="这轮先不考">
          取消
        </button>
        <b>{title}</b>
        <span className="muted">这轮要考 {cards.length} 个词</span>
        <button className="primary" onClick={onStart}>
          看完了，开始拷打
        </button>
      </div>

      <div className="muted drill-warm-hint">
        {kind === 'chunk'
          ? '先认一遍词块（词组 / 习语）再开考 —— 不认识的搭配，考出来只是猜。'
          : '先认一遍词和释义再开考 —— 第一次见的词答错，不算没记住。'}
      </div>

      {cards.length === 0 ? (
        <div className="muted drill-warm-empty">这轮没有可预习的词（题目里没有词条信息）。</div>
      ) : (
        <div className="drill-warm-list">
          {cards.map((c) => (
            <div className="drill-warm-card" key={c.id}>
              <div className="drill-warm-word">
                <b>{c.word}</b>
                {c.phonetic && <span className="muted">{c.phonetic}</span>}
              </div>
              {c.meaning && <div className="drill-warm-meaning">{c.meaning}</div>}
              {c.chunks.length > 0 && (
                <ul className="drill-warm-chunks">
                  {c.chunks.map((s, i) => (
                    // 同一条词块可能在不同词下重复出现，key 用下标即可（列表短、不重排）
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              )}
              {c.example && <div className="drill-warm-ex">{c.example}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="bar drill-warm-foot">
        <button className="primary" onClick={onStart}>
          看完了，开始拷打
        </button>
        <span className="muted">开考后按题型作答；答对推进 SRS，答错进错题本</span>
      </div>
    </div>
  )
}
