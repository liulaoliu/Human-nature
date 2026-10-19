import type { RefObject } from 'react'
import type { Sentence } from '../types/document'
import type { ReaderDoc } from './hooks/useReaderDoc'
import ReaderBody from './panels/ReaderBody'

/**
 * 阅读正文区：标题（可改名）+ 编辑态 textarea + `ReaderBody`。
 * 只搬渲染，不改行为；外层「是否显示」的条件仍留在 `ReaderApp`。
 */
export interface ReaderArticleProps {
  doc: ReaderDoc
  articleTitle: string
  articleKey: string | null
  onRename: () => void

  editing: boolean
  draft: string
  onDraftChange: (value: string) => void

  translateView: 'off' | 'below' | 'only'
  selectedId: string | null
  peekSid: string | null
  vocabSidSet: Set<string>
  selSid: string | null
  selIndices: number[]
  libraryLemmas: Set<string>
  /** 本篇生词编号（lemma → 序号）与「序号首次出现的 句子:词位」集合。 */
  articleNums: Map<string, number>
  articleFirst: Set<string>
  showLanguage: boolean
  vocabMode: boolean
  lastPicked: { word: string; sid: string } | null
  bubblePos: { top: number; left: number } | null
  articleRef: RefObject<HTMLElement>
  onSelectSentence: (sid: string) => void
  onFocusEntry: (word: string) => void
  onAltCopyText: (text: string) => void
  karaoke: { sid: string; activeIndex: number | null } | null
  /** 点正文里的词：从该词开始朗读（词下标由 ReaderBody 给出）。 */
  onSpeakFromWord: (text: string, wordIndex: number) => void
  onAddPhrase: (items: string[], sentence: Sentence) => void
}

export default function ReaderArticle({
  doc,
  articleTitle,
  articleKey,
  onRename,
  editing,
  draft,
  onDraftChange,
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
  onAltCopyText,
  karaoke,
  onSpeakFromWord,
  onAddPhrase,
}: ReaderArticleProps) {
  return (
    <>
      <h1>
        {articleTitle || (articleKey ? articleKey : '手动粘贴')}
        <button className="title-edit" onClick={onRename} title="修改文章标题" aria-label="修改文章标题">
          ✎
        </button>
      </h1>
      {editing ? (
        <>
          <div className="meta">编辑正文：改完点「完成」重新切句；已粘回的翻译/语法按句文保留。</div>
          <textarea
            className="manual"
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            aria-label="编辑正文"
            autoFocus
          />
        </>
      ) : (
        <>
          <div className="meta">点句子=整句；拖动选词组（按整词吸附）；Ctrl 点单词。</div>
          <ReaderBody
            paragraphs={doc.paragraphs}
            sentences={doc.sentences}
            translateView={translateView}
            selectedId={selectedId}
            peekSid={peekSid}
            vocabSidSet={vocabSidSet}
            selSid={selSid}
            selIndices={selIndices}
            libraryLemmas={libraryLemmas}
            articleNums={articleNums}
            articleFirst={articleFirst}
            showLanguage={showLanguage}
            vocabMode={vocabMode}
            lastPicked={lastPicked}
            bubblePos={bubblePos}
            articleRef={articleRef}
            onSelectSentence={onSelectSentence}
            onFocusEntry={onFocusEntry}
            onAltCopyText={onAltCopyText}
            karaoke={karaoke}
            onWordSeek={(sid, i) => {
              const s = doc.sentences.find((x) => x.id === sid)
              if (s) onSpeakFromWord(s.text, i)
            }}
            onAddPhrase={onAddPhrase}
          />
        </>
      )}
    </>
  )
}
