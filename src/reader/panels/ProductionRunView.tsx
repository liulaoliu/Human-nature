import { useState } from 'react'
import type { useProductionSession } from '../hooks/useProductionSession'
import GoldenFeedback from './golden/GoldenFeedback'
import ProductionHint from './ProductionHint'
import ProductionReview from './ProductionReview'
import VoiceInputButton from './VoiceInputButton'

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
 * 判分和目标块硬校验都在 `core/production`，这里只画。
 */
export default function ProductionRunView({ model, current }: ProductionRunViewProps) {
  const { settings } = model
  const isYogurt = model.sessionMode === 'yogurt'
  const isFull = model.sessionMode === 'full'
  const [pasteText, setPasteText] = useState('')
  const pastePrompt = model.pendingPrompt
  const showPaste = !!model.pasteKind && !(isYogurt && model.pasteKind === 'pack')

  return (
    <div className="production-body">
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

      {showPaste && (
        <div className="production-paste">
          <div className="muted">
            {model.pasteKind === 'pack' ? '把 AI 返回的题目 JSON 粘到这里' : '把 AI 返回的批改 JSON 粘到这里'}
          </div>
          <textarea
            rows={6}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <div className="bar">
            <button className="primary" onClick={() => model.applyPaste(pasteText)} disabled={!pasteText.trim()}>
              应用 AI 返回
            </button>
            <button onClick={() => void model.copyPromptAgain()} disabled={!pastePrompt}>
              复制提示词
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
