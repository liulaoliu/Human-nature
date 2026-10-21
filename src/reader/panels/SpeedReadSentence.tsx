import type { ReactNode } from 'react'
import type { Sentence } from '../../types/document'
import { getSentenceLanguages } from '../../core/language'
import type { SpeedReadDrill } from '../../core/speedRead'
import LanguageLines from './LanguageLines'

export type SpeedReadPhase = 'read' | 'reveal' | 'drill' | 'drill-answer'

export interface SpeedReadSentenceProps {
  sentence: Sentence
  phase: SpeedReadPhase
  sentenceParts: ReactNode
  over: boolean
  words: number
  target: number
  elapsed: number
  pace: number
  pickMode: boolean
  vocabMode: boolean
  autoDrill: boolean
  drill: SpeedReadDrill | null
  picked: string
  drillOk: boolean | null
  readMs: number
  slow: boolean
  selWords: string[]
  addedWord: string
  wordDraft: string
  knownWords: string[]
  confirmDel: string | null
  ttsState: 'idle' | 'loading' | 'playing'
  onAddPhrases?: (items: string[], sentence: Sentence) => void
  addSelected: () => void
  mergePhrase: () => void
  setWordDraft: (v: string) => void
  addCustom: (w: string) => void
  tapRemove: (w: string) => void
  advance: () => void
  onClose: () => void
  onSpeak: (text: string) => void
  /** 按住 Alt 点句子：复制整句（与阅读页同一个实现）。 */
  onCopyText: (text: string) => void
  chooseDrill: (opt: string) => void
}

/** 速读单句区：原文 / 揭示 / 拷打 / 加词 / 操作栏。状态和计时在 SpeedReadPanel。 */
export default function SpeedReadSentence(props: SpeedReadSentenceProps) {
  const {
    sentence, phase, sentenceParts, over, words, target, elapsed, pace, pickMode, vocabMode,
    autoDrill, drill, picked, drillOk, readMs, slow, selWords, addedWord, wordDraft, knownWords,
    confirmDel, ttsState, onAddPhrases, addSelected, mergePhrase, setWordDraft, addCustom,
    tapRemove, advance, onClose, onSpeak, onCopyText, chooseDrill,
  } = props

  return (
    <>
            <div className="study-card speed-card">
              <div className="bar speed-meta">
                <span className={over ? 'speed-pace over' : 'speed-pace ok'}>{over ? '⏱ 超时' : '⚡ 在配速内'}</span>
                <span className="muted">
                  {words} 词 · 目标 {(target / 1000).toFixed(1)}s · 已用 {(elapsed / 1000).toFixed(1)}s
                </span>
              </div>
              <div className="speed-timebar">
                <div className={over ? 'over' : ''} style={{ width: `${pace}%` }} />
              </div>

              {/* 拷打时隐藏原文文字，但保留 div 占位，避免布局跳动 */}
              <div className="speed-sentence-slot">
              {/* 捕获阶段处理 Alt 点击：词 span 自己会 stopPropagation，冒泡阶段收不到 */}
              <div
                className={'speed-sentence' + (phase === 'drill' ? ' is-hidden' : '')}
                style={{ userSelect: pickMode || vocabMode ? 'none' : 'text' }}
                onClickCapture={(e) => {
                  if (!e.altKey) return
                  e.preventDefault()
                  e.stopPropagation()
                  onCopyText(sentence.text)
                }}
                title="按住 Alt 点击 = 复制整句"
              >
                {sentenceParts}
              </div>
                {phase === 'drill' && (
                  <div className="speed-hidden-overlay">原文已隐藏 —— 只看挖空句，从选项里选</div>
                )}
              </div>

              {phase === 'read' && (
                <div className="speed-hint muted">
                  先自己读一遍 → 按 <kbd>R</kbd> 朗读，<kbd>空格</kbd> 看释义与语言点；
                  <kbd>Alt</kbd> + 点击可复制整句
                </div>
              )}

              {(phase === 'reveal' || phase === 'drill-answer') && (
                <div className="speed-reveal">
                  {sentence.translation && <div className="speed-tr">{sentence.translation}</div>}
                  {getSentenceLanguages(sentence).map((L, li) => (
                    <div className="speed-lang" key={li}>
                      {L.source === 'manual' && <div className="muted">手动语言点</div>}
                      <LanguageLines
                        lang={L}
                        onAddPhrases={onAddPhrases ? (items) => onAddPhrases(items, sentence) : undefined}
                      />
                    </div>
                  ))}
                  {sentence.collocations.length > 0 && <div className="muted">搭配：{sentence.collocations.join('；')}</div>}
                  {readMs > 0 && (
                    <div className="muted">
                      本句速度 {Math.round((words / readMs) * 60000)} 词/分{slow ? '（超时）' : ''}
                    </div>
                  )}
                  {slow && (
                    <div className="speed-banner">
                      {autoDrill && drill ? '⏱ 超时了，先来一道再继续' : '⏱ 这句超时了（没题可练，直接继续）'}
                    </div>
                  )}
                </div>
              )}

              {(phase === 'drill' || phase === 'drill-answer') && drill && (
                <div className="speed-drill">
                  <div className="speed-drill-title">
                    拷打：把空填回来
                    <span className="muted">（{drill.via === 'phrase' ? '语言点搭配' : drill.via === 'vocab' ? '本句生词' : '实词'}）</span>
                  </div>
                  <div className="speed-drill-prompt">{drill.prompt}</div>
                  <div className="quiz-options">
                    {drill.options.map((opt, i) => {
                      const cls = !picked
                        ? ''
                        : opt === drill.answer
                          ? 'primary'
                          : opt === picked
                            ? 'danger'
                            : ''
                      return (
                        <button key={opt} className={cls} disabled={!!picked} onClick={() => chooseDrill(opt)}>
                          <kbd>{i + 1}</kbd> {opt}
                        </button>
                      )
                    })}
                  </div>
                  {picked && (
                    <div className={'speed-drill-result ' + (drillOk ? 'ok' : 'bad')}>
                      {drillOk ? '✔ 正确' : `✘ 正确答案：${drill.answer}`}
                      <div className="muted speed-answer-sentence">{sentence.text}</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {phase !== 'drill' && (
              <div className="speed-addword">
                <div className="speed-selbar">
                  <span className="muted">勾顶栏「选词模式」后：点词选中 → 「加入清单」或右键入库；右上角清单可删除误加。</span>
                  {selWords.length > 0 && <b>已选：{selWords.join(' · ')}</b>}
                  {addedWord && <span className="speed-added">✔ 已加入：{addedWord}</span>}
                </div>
                <div className="speed-addword-row">
                  <button className="primary" disabled={!selWords.length} onClick={addSelected}>
                    ＋ 加入清单{selWords.length ? `（${selWords.length}）` : ''}
                  </button>
                  {selWords.length > 1 && (
                    <button
                      onClick={mergePhrase}
                      title="把本句选中的词按顺序合成一个词组（中间夹着的词不加入；同一个词的不同位置互不影响）"
                    >
                      ＋ 合成本句词组
                    </button>
                  )}
                  <input
                    className="speed-addword-input"
                    placeholder="也可手打词 / 词组，回车加入"
                    value={wordDraft}
                    onChange={(e) => setWordDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addCustom(wordDraft)
                      }
                    }}
                  />
                  <button disabled={!wordDraft.trim()} onClick={() => addCustom(wordDraft)}>
                    加入
                  </button>
                </div>
                {knownWords.length > 0 && (
                  <div className="speed-known">
                    <span className="muted">本句已在生词本（点两下移出）：</span>
                    {knownWords.map((w) => (
                      <button
                        key={w}
                        className={'speed-known-chip' + (confirmDel === w ? ' danger' : '')}
                        onClick={() => tapRemove(w)}
                        title={confirmDel === w ? '再点一次确认移出' : '移出生词本（两步确认）'}
                      >
                        {confirmDel === w ? `确认移出「${w}」` : w}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="bar study-actions">
              <button onClick={() => onSpeak(sentence.text)} title="朗读本句（R；已缓存则秒播）">
                {ttsState === 'loading' ? '🔊 合成中…' : '🔊 读本句'}
              </button>
              {phase === 'read' && (
                <button className="primary" onClick={advance}>
                  读完了（空格）
                </button>
              )}
              {phase === 'reveal' && (
                <button className="primary" onClick={advance}>
                  {slow && autoDrill && drill ? '来一道（空格）' : '下一句（空格）'}
                </button>
              )}
              {phase === 'drill-answer' && (
                <button className="primary" onClick={advance}>
                  下一句（空格）
                </button>
              )}
              <button onClick={onClose}>退出</button>
            </div>
    </>
  )
}
