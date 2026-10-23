import type { SentenceLanguage } from '../../types/document'
import { KIND_LABEL } from '../../core/entryKind'
import LangPhrases from './LangPhrases'

export interface LanguageLinesProps {
  lang: SentenceLanguage
  /** 词组 / 习语可点一下加入生词本（不传 = 按钮不可点，和原来的正文/速读行为一致）。 */
  onAddPhrases?: (items: string[]) => void
  /** 纯文本：日志这类只读场景不渲染按钮。 */
  plain?: boolean
}

/**
 * 一条语言点的正文（结构 / 语法 / 习语 / 词组 / 用法）。
 *
 * 正文、速读、日志三处原来各写一份同样的五行——文案与顺序只在这里定义一次。
 * 「加语言点」本身也只有一个编辑器（`LanguageEditor`，两处入口都走它）。
 *
 * **为什么根节点是 span 而不是 div**：这组件会被塞进阅读正文的 `<p className="para">` 里
 * （每句话的语言点挂在句子下面）。HTML 规定 `<p>` 只能放 phrasing content（span / b / button…），
 * 放 `<div>` 属于非法嵌套，React 18 会在 console 报 `validateDOMNesting` 警告。
 * 这里一律用 span，块级外观交给 CSS（`.lang-line` / `.lang-phrases` 都是 display:block/flex）。
 */
export default function LanguageLines({ lang: L, onAddPhrases, plain }: LanguageLinesProps) {
  return (
    <>
      {L.structure && <span className="lang-line">结构：{L.structure}</span>}
      {L.grammar && <span className="lang-line">语法：{L.grammar}</span>}
      {plain ? (
        <>
          {L.idioms?.length ? <span className="lang-line">{KIND_LABEL.idiom}：{L.idioms.join('；')}</span> : null}
          {L.phrases?.length ? <span className="lang-line">{KIND_LABEL.phrase}：{L.phrases.join('；')}</span> : null}
        </>
      ) : (
        <>
          <LangPhrases label={KIND_LABEL.idiom} items={L.idioms ?? []} onAdd={onAddPhrases} />
          <LangPhrases label={KIND_LABEL.phrase} items={L.phrases ?? []} onAdd={onAddPhrases} />
        </>
      )}
      {L.usage?.length ? <span className="lang-line">用法：{L.usage.join('；')}</span> : null}
    </>
  )
}
