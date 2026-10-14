import type { VocabCardBlock } from '../../core/vocab'

/**
 * 背单词卡片的「带小标题内容块」：用法 / 词组 / 习语 / 例句 / 来源 / 易混。
 *
 * 结构由 core/vocab 的 `vocabCardBlocks` 归一化（固定的顺序与文案），
 * 这里只负责排版，保证「背单词卡片」和「生词本卡片」两块长得一致。
 */
export default function VocabBlocks({
  blocks,
  className,
}: {
  blocks: VocabCardBlock[]
  className?: string
}) {
  if (!blocks.length) return null
  return (
    <div className={'vblocks' + (className ? ' ' + className : '')}>
      {blocks.map((b) => (
        <div className={'vblock vblock-' + b.key} key={b.key}>
          <span className="vblock-label">{b.label}</span>
          <span className="vblock-lines">
            {b.lines.map((line, i) => (
              <span className="vblock-line" key={i}>
                {line}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  )
}
