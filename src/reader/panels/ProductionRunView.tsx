import { useEffect, useRef, useState } from 'react'
import type { useProductionSession } from '../hooks/useProductionSession'
import { useGoldenPasteBox } from '../hooks/useGoldenPasteBox'
import GoldenFeedback from './golden/GoldenFeedback'
import GoldenPasteBox from './golden/GoldenPasteBox'
import ProductionHint from './ProductionHint'
import ProductionReview from './ProductionReview'
import VoiceInputButton from './VoiceInputButton'
import YogurtPairEditor from './production/YogurtPairEditor'

type ProductionModel = ReturnType<typeof useProductionSession>

export interface ProductionRunViewProps {
  /** 批改复盘区（`ProductionReview`）本来就按整包 model 取数，这里不重复拆一遍。 */
  model: ProductionModel
  /** 父层已经判过 `current` 存在；这里不再重复判空，避免整屏条件满天飞。 */
  current: NonNullable<ProductionModel['current']>
}

/**
 * 挤奶：题干 / 挖空提示 / 作答 / 批改反馈 / 第二稿重写。
 *
 * 风味酸奶多一列左侧断句列表：做完一半发现这句该拆开，直接在这里改，
 * 题号跟着同一句走（`remapYogurtPrompts`），不会被踢回第一题。
 * 判分和目标块硬校验都在 `core/production`，这里只画。
 */
export default function ProductionRunView({ model, current }: ProductionRunViewProps) {
  const { settings } = model
  const isYogurt = model.sessionMode === 'yogurt'
  const isFull = model.sessionMode === 'full'
  const yogurt = model.yogurt
  const [editing, setEditing] = useState(false)
  const paste = useGoldenPasteBox()
  const pastePrompt = model.pendingPrompt
  const showPaste = !!model.pasteKind && !(isYogurt && model.pasteKind === 'pack')
  const activeRef = useRef<HTMLLIElement | null>(null)
  const pasteOpen = paste.setOpen

  // 没配 AI 时「批改」会退化成复制提示词：这里自动展开粘回框，和本句仿写一致。
  useEffect(() => {
    if (model.pasteKind) pasteOpen(true)
  }, [model.pasteKind, pasteOpen])

  useEffect(() => {
    // jsdom 里没有 scrollIntoView，用可选调用兜住
    activeRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [model.index, editing])

  const toggleEdit = () => {
    if (editing) {
      setEditing(false)
      return
    }
    yogurt.beginEdit()
    setEditing(true)
  }

  const body = (
    <>
      <div className="production-progress">
        <span>
          第 {model.index + 1} / {model.prompts.length} 题 · 第 {model.round} 稿
        </span>
        <span className="muted">
          {current.targets.length
            ? `目标块 ${current.targets.length} 个（答完再看具体是哪些）`
            : isYogurt
              ? '风味酸奶 · 参考译文答完再看'
              : isFull
                ? '全脂随机主题 · 不限定目标块'
                : '主题翻译 · 不限定目标块'}
        </span>
      </div>

      {model.notice && <div className="production-notice">{model.notice}</div>}

      <div className="production-prompt">
        <div className="production-zh">{current.zh}</div>
        {current.goal && <div className="muted">目标：{current.goal}</div>}
        {settings.variant !== 'translate' &&
          current.model &&
          current.targets.length > 0 && (
            <ProductionHint
              key={current.id}
              mode={settings.variant}
              model={current.model}
              targets={current.targets}
              value={model.answer}
              onChange={model.setAnswer}
              seed={current.id}
            />
          )}
        {model.speak && (
          <div className="bar">
            <button onClick={() => model.speak?.(current?.zh ?? '')} title="朗读题干；先听再写">
              🔊 听题干
            </button>
          </div>
        )}
      </div>

      {!model.feedback && (
        <>
          {model.round === 2 && model.previousFeedback && (
            <details className="production-prev" open>
              <summary>上一版批改（照着改，别原样再交）</summary>
              {current.reference && (
                <div className="production-reference">
                  <b>参考译文：</b>
                  {current.reference}
                </div>
              )}
              <GoldenFeedback feedback={model.previousFeedback} />
              {model.hits.length > 0 && (
                <div className="production-hits">
                  {model.hits.map((h) => (
                    <span key={h.id} className={h.used ? 'ok' : 'bad'}>
                      {h.text}：{h.used ? '用上了' : '没用上'}
                    </span>
                  ))}
                </div>
              )}
            </details>
          )}
          <textarea
            className="production-answer"
            rows={6}
            value={model.answer}
            onChange={(e) => model.setAnswer(e.target.value)}
            placeholder={
              model.round === 1
                ? current.targets.length
                  ? '先自己写一版英文，不要先看答案…'
                  : isYogurt
                    ? current.answerLang === 'zh'
                      ? '先自己翻成中文；参考译文在批改前不会出现…'
                      : '先自己翻译这句；参考译文在批改前不会出现…'
                    : isFull
                      ? '按随机主题自己写一版英文，不要先看答案…'
                      : '围绕主题自己写一版英文，不要先看答案…'
                : current.targets.length
                  ? '按批改意见重写一版；目标块仍然要用上。'
                  : isYogurt
                    ? '按批改意见重写一版；对照参考译文改得更自然。'
                    : '按批改意见重写一版，写得更自然。'
            }
            disabled={model.grading || model.generating}
          />
          <div className="bar">
            <VoiceInputButton
              lang={current.answerLang === 'zh' ? 'zh-CN' : 'en-US'}
              label="🎙 语音写答案"
              onText={(text) =>
                model.setAnswer(`${model.answer}${model.answer.trim() ? ' ' : ''}${text}`)
              }
            />
            <button
              className="primary"
              onClick={() => void model.grade()}
              disabled={!model.answer.trim() || model.answer.includes('_____') || model.grading || model.generating}
            >
              {model.grading ? '批改中…' : model.round === 1 ? '批改这一稿' : '提交重写并批改'}
            </button>
            {model.grading && <button onClick={model.cancelRun}>取消</button>}
            <button onClick={model.skip} title="不保存这一题的批改，直接进入下一题">
              跳过这题
            </button>
          </div>
        </>
      )}

      <ProductionReview model={model} />

      {model.error && (
        <div className="production-error">
          {model.error}{' '}
          <button
            onClick={() => void (model.stage === 'playing' ? model.grade() : model.start())}
            title="用同一份设置再试一次"
          >
            重试
          </button>
        </div>
      )}

      {(showPaste || !!pastePrompt) && (
        <GoldenPasteBox
          label={
            model.pasteKind === 'pack'
              ? '把 AI 返回的题目 JSON 粘到这里（或在这里粘贴别处拿到的批改）'
              : '把 AI 返回的批改 JSON 粘到这里'
          }
          value={paste.text}
          onChange={paste.setText}
          onApply={() =>
            paste.apply((text) => {
              if (!model.applyPaste(text)) return false
              if (pastePrompt) void model.copyPromptAgain()
              return true
            })
          }
          placeholder={'{"version":2,"scores":[…],"issues":[…],"polished":"…","summary":"…"}'}
          open={paste.open}
          onOpenChange={paste.setOpen}
        />
      )}
    </>
  )

  if (!isYogurt) return <div className="production-body">{body}</div>

  return (
    <div className="production-body production-run">
      <aside className="production-side">
        <div className="bar">
          <b>断句</b>
          <span className="muted">
            {model.index + 1} / {yogurt.sessionPairs.length}
          </span>
          <button onClick={toggleEdit}>{editing ? '收起编辑器' : '改断句'}</button>
        </div>
        <ol className="production-sentences">
          {yogurt.sessionPairs.map((pair, i) => {
            const state = i < model.index ? '已交' : i === model.index ? '当前' : '待做'
            return (
              <li
                key={`${i}-${pair.source.slice(0, 8)}`}
                ref={i === model.index ? activeRef : null}
              >
                <span className={'production-sentence' + (i === model.index ? ' on' : '')}>
                  <span className="muted">{i + 1}</span>
                  <span className="production-sentence-text">{pair.source || '（空）'}</span>
                  <span className={'production-sentence-state' + (i < model.index ? ' done' : '')}>
                    {state}
                  </span>
                </span>
              </li>
            )
          })}
        </ol>
        {yogurt.sessionPairs.length < model.prompts.length && (
          <p className="muted">最后还有一道整段连写（第 {model.prompts.length} 题）。</p>
        )}
        {editing && (
          <YogurtPairEditor
            yogurt={yogurt}
            sourceLabel="原文"
            referenceLabel="参考译文"
            onApply={() => {
              if (yogurt.apply()) setEditing(false)
            }}
            applyLabel="应用断句，继续这一题"
            onCancel={() => setEditing(false)}
          />
        )}
      </aside>
      <div className="production-main">{body}</div>
    </div>
  )
}
