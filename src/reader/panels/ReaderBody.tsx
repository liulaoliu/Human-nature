import type { ReactNode, RefObject } from 'react'
import { wordSpans } from '../../core/wordSelect'
import { lemmaOf } from '../../core/vocab'
import type { Paragraph, Sentence } from '../../types/document'

/** 把一句话渲染成「词 span（生词包成 .vw + 序号上标） + 标点文本」，选中的词加 .hl。
 *  朗读中（kara 非空）时：每个词都可点、并从该词起播，当前词高亮。 */
function sentenceNodes(
  text: string,
  active: Set<number> | null,
  lemmas: Set<string>,
  onWord: (word: string) => void,
  sid?: string,
  nums?: Map<string, number> | null,
  firstNums?: Set<string> | null,
  kara?: { activeIndex: number | null; onSeek: (i: number) => void } | null,
): ReactNode[] {
  const spans = wordSpans(text)
  const out: ReactNode[] = []
  let pos = 0
  spans.forEach((w, i) => {
    if (w.start > pos) out.push(text.slice(pos, w.start))
    const on = active !== null && active.has(i)
    const key = w.text.toLowerCase()
    const isVocab = lemmas.has(key) || lemmas.has(lemmaOf(key))
    const num = nums ? (nums.get(lemmaOf(key)) ?? nums.get(key)) : undefined
    const showNum = num != null && !!firstNums?.has(`${sid}:${i}`)
    if (kara) {
      out.push(
        <span
          key={`w${i}`}
          className={'kara' + (i === kara.activeIndex ? ' kara-on' : '') + (isVocab ? ' vw' : '')}
          onClick={(e) => {
            e.stopPropagation()
            kara.onSeek(i)
          }}
          title="从这个词开始朗读"
        >
          {w.text}
          {showNum && <sup className="wnum">{num}</sup>}
        </span>,
      )
    } else if (on) {
      out.push(
        <span key={`w${i}`} className="hl">
          {w.text}
        </span>,
      )
    } else if (isVocab) {
      out.push(
        <span key={`w${i}`} className="vw" onClick={() => onWord(w.text)} title="在生词本里查看">
          {w.text}
          {showNum && <sup className="wnum">{num}</sup>}
        </span>,
      )
    } else {
      out.push(w.text)
    }
    pos = w.end
  })
  if (pos < text.length) out.push(text.slice(pos))
  return out
}

export interface ReaderBodyProps {
  paragraphs: Paragraph[]
  sentences: Sentence[]
  translateView: 'off' | 'below' | 'only'
  selectedId: string | null
  peekSid: string | null
  /** 有生词的句子 id 集合（用于底色标记）。 */
  vocabSidSet: Set<string>
  /** 精确选区所在的句子 id 与词下标。 */
  selSid: string | null
  selIndices: number[]
  libraryLemmas: Set<string>
  /** 本篇生词编号（lemma → 序号）与「序号首次出现的 句子:词位」集合。 */
  articleNums: Map<string, number>
  articleFirst: Set<string>
  showLanguage: boolean
  vocabMode: boolean
  lastPicked: { word: string } | null
  bubblePos: { top: number; left: number } | null
  /** 正文容器 ref（点选滚动、跟随高亮用）。 */
  articleRef: RefObject<HTMLElement>
  onSelectSentence: (sid: string) => void
  onFocusEntry: (word: string) => void
  /** 正在朗读的句子（逐词高亮）。 */
  karaoke: { sid: string; activeIndex: number | null } | null
  /** 点某个词 → 从该词起播。 */
  onWordSeek: (sid: string, wordIndex: number) => void
}

/** 阅读正文：段落/句子 + 生词高亮 + 译文/语言点 + 点句选中 + 选词气泡。 */
export default function ReaderBody({
  paragraphs,
  sentences,
  translateView,
  selectedId,
  peekSid,
  vocabSidSet,
  selSid,
  selIndices,
  libraryLemmas,
  articleNums,
  articleFirst,
  showLanguage,
  vocabMode,
  lastPicked,
  bubblePos,
  articleRef,
  onSelectSentence,
  onFocusEntry,
  karaoke,
  onWordSeek,
}: ReaderBodyProps) {
  return (
    <article className={'article' + (translateView === 'only' ? ' tr-only' : '')} ref={articleRef}>
      {vocabMode && lastPicked && bubblePos && (
        <div className="bubble" style={{ top: bubblePos.top, left: bubblePos.left }}>
          {lastPicked.word}
        </div>
      )}
      {paragraphs.map((p) => (
        <p className="para" key={p.id}>
          {p.sentenceIds.map((sid) => {
            const s = sentences.find((x) => x.id === sid)
            if (!s) return null
            return (
              <span key={sid} className="s-pair">
                <span
                  data-sid={sid}
                  className={
                    'sent' +
                    (selectedId === sid ? ' sel' : '') +
                    (peekSid === sid && selectedId !== sid ? ' peek' : '') +
                    (vocabSidSet.has(sid) ? ' has-vocab' : '')
                  }
                  onClick={() => onSelectSentence(sid)}
                >
                  {sentenceNodes(
                    s.text,
                    selSid === sid && selIndices.length ? new Set(selIndices) : null,
                    libraryLemmas,
                    onFocusEntry,
                    sid,
                    articleNums,
                    articleFirst,
                    karaoke && karaoke.sid === sid
                      ? { activeIndex: karaoke.activeIndex, onSeek: (i) => onWordSeek(sid, i) }
                      : null,
                  )}{' '}
                </span>
                {translateView !== 'off' && (s.translation || translateView === 'only') && (
                  <span
                    data-sid={sid}
                    className={'tr-block' + (selectedId === sid ? ' sel' : '')}
                    onClick={() => onSelectSentence(sid)}
                    title="点这里等价于选中这句"
                  >
                    {s.translation ?? '（未翻译）'}
                  </span>
                )}
                {showLanguage && s.language && (
                  <span className="lang-block">
                    {s.language.structure && <div>结构：{s.language.structure}</div>}
                    {s.language.grammar && <div>语法：{s.language.grammar}</div>}
                    {s.language.idioms?.length ? <div>习语：{s.language.idioms.join('；')}</div> : null}
                    {s.language.phrases?.length ? <div>词组：{s.language.phrases.join('；')}</div> : null}
                    {s.language.usage?.length ? <div>用法：{s.language.usage.join('；')}</div> : null}
                  </span>
                )}
              </span>
            )
          })}
        </p>
      ))}
    </article>
  )
}
