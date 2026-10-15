/**
 * 语言点里的「词组 / 习语」一行：每条都能点一下**加入生词本**（`英文 — 中文` 会拆成词条 + 释义）。
 * 速读与正文共用，保证两处一致。
 */
export default function LangPhrases({
  label,
  items,
  onAdd,
}: {
  label: string
  items: string[]
  onAdd?: (items: string[]) => void
}) {
  if (!items.length) return null
  return (
    <div className="lang-phrases">
      <span className="lang-phrases-label">{label}：</span>
      {items.map((p, i) => (
        <button
          className="phrase-add"
          key={i}
          title={onAdd ? '加入生词本（带释义）' : undefined}
          onClick={(e) => {
            e.stopPropagation()
            onAdd?.([p])
          }}
          disabled={!onAdd}
        >
          {p}
          {onAdd ? <span className="phrase-plus">＋</span> : null}
        </button>
      ))}
      {onAdd && items.length > 1 ? (
        <button className="phrase-add all" onClick={(e) => (e.stopPropagation(), onAdd(items))} title="全部加入生词本">
          全部 ＋
        </button>
      ) : null}
    </div>
  )
}
