import { useState } from 'react'
import { KIND_LABEL } from '../../core/entryKind'
import {
  isProductionTask,
  productionHits,
  PRODUCTION_ANGLE_LABEL,
  PRODUCTION_ANGLES,
  PRODUCTION_MODE_DESC,
  PRODUCTION_MODE_LABEL,
  PRODUCTION_MODES,
  PRODUCTION_PROMPT_COUNTS,
  PRODUCTION_TARGETS_PER_PROMPT,
  PRODUCTION_TARGET_TYPES,
  PRODUCTION_TONE_LABEL,
  PRODUCTION_TONES,
  PRODUCTION_WEAK_RATIOS,
  type ProductionTargetKind,
} from '../../core/production'
import { writingRecordLabel } from '../../core/writing'
import type { useProductionSession } from '../hooks/useProductionSession'
import GoldenFeedback from './golden/GoldenFeedback'
import RoundSizeSelect from './RoundSizeSelect'

export interface ProductionPanelProps {
  model: ReturnType<typeof useProductionSession>
}

const TOPIC_PRESETS = ['工作沟通', '旅行见闻', '表达观点', '生活小事']

const TARGET_TYPE_LABEL: Record<ProductionTargetKind, string> = {
  word: KIND_LABEL.word,
  phrase: `${KIND_LABEL.phrase} / 搭配`,
  idiom: KIND_LABEL.idiom,
}

/**
 * D老师奶牛工棚：吃进去的是词块，挤出来的是自己的英文。
 *
 * 页面只负责把 hook 的状态画出来；出题、批改、目标块硬校验、落盘都在
 * `useProductionSession` / `core/production`。
 */
export default function ProductionPanel({ model }: ProductionPanelProps) {
  const [pasteText, setPasteText] = useState('')
  const articleTitle = model.articleTitle
  const { settings, updateSettings } = model
  const pastePrompt = model.pendingPrompt
  const isYogurt = settings.mode === 'yogurt'
  const isSkim = settings.mode === 'skim'
  const isFull = settings.mode === 'full'
  const useChunks = isYogurt ? false : isFull ? settings.fullUseChunks : settings.skimUseChunks
  const showPaste = !!model.pasteKind && !(isYogurt && model.pasteKind === 'pack')
  const canStart = isYogurt
    ? !!settings.sourceText.trim() && !!settings.referenceText.trim()
    : isSkim
      ? !!settings.topic.trim() && (!useChunks || !!settings.types.length)
      : !useChunks || !!settings.types.length

  const toggleType = (kind: ProductionTargetKind, on: boolean) => {
    const types = on ? [...new Set([...settings.types, kind])] : settings.types.filter((t) => t !== kind)
    updateSettings({ types })
  }

  return (
    <div className="study production">
      <div className="bar study-bar">
        <button onClick={model.close} title="结束本组；已提交的作答会留在历史里">
          结束
        </button>
        <b>🐄 D老师奶牛工棚</b>
        <span className="muted">
          {model.stage === 'setup' ? '选草料' : model.stage === 'playing' ? '挤奶中' : '收工'}
          {articleTitle ? ` · ${articleTitle}` : ''}
        </span>
      </div>

      {model.stage === 'setup' && (
        <div className="production-body">
          <div className="production-hero">
            <b>把想说的话，真的写成英文。</b>
            <span className="muted">三种吃法：全脂随机、脱脂奶按主题、风味酸奶逐句翻译；批改后再重写一版。</span>
          </div>

          <div className="production-modes" role="group" aria-label="选择训练模式">
            {PRODUCTION_MODES.map((mode) => (
              <button
                key={mode}
                className={'production-mode' + (settings.mode === mode ? ' active' : '')}
                aria-pressed={settings.mode === mode}
                onClick={() => updateSettings({ mode })}
              >
                <b>{PRODUCTION_MODE_LABEL[mode]}</b>
                <span className="muted">{PRODUCTION_MODE_DESC[mode]}</span>
              </button>
            ))}
          </div>

          {isYogurt ? (
            <div className="production-field">
              <span className="muted">中文原文</span>
              <textarea
                aria-label="风味酸奶中文原文"
                rows={7}
                value={settings.sourceText}
                onChange={(e) => updateSettings({ sourceText: e.target.value })}
                placeholder="把在网上看到、值得背的中文段落粘到这里…"
              />
              <span className="muted">英文参考译文（答完 / 批改前不会显示）</span>
              <textarea
                aria-label="风味酸奶英文参考译文"
                rows={7}
                value={settings.referenceText}
                onChange={(e) => updateSettings({ referenceText: e.target.value })}
                placeholder="把 Google 翻译 / 其他参考译文粘到这里…"
              />
              <span className="muted">
                可以按段落粘贴；句数对不上时按顺序配对，末尾多出的内容并入最后一题。逐句练习在本机拆，不需要 AI。
              </span>
            </div>
          ) : (
            <>
              {settings.mode === 'skim' ? (
                <div className="production-field">
                  <span className="muted">主题</span>
                  <input
                    className="production-topic"
                    aria-label="产出主题"
                    value={settings.topic}
                    onChange={(e) => updateSettings({ topic: e.target.value })}
                    placeholder="例如：远程办公的利弊 / 跟房东解释热水器坏了"
                    maxLength={200}
                  />
                  <div className="bar">
                    {TOPIC_PRESETS.map((t) => (
                      <button key={t} onClick={() => updateSettings({ topic: t })}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="production-field">
                  <span className="muted">
                    {useChunks
                      ? '全脂：AI 随机定主题，并从本机词库随机抽目标块，出不同场景。'
                      : '全脂：AI 随机定主题，不使用本机词块。'}
                  </span>
                </div>
              )}

              <div className="production-field">
                <label className="check-inline">
                  <input
                    type="checkbox"
                    aria-label={isFull ? '全脂使用本机词块' : '脱脂奶使用本机词块'}
                    checked={isFull ? settings.fullUseChunks : settings.skimUseChunks}
                    onChange={(e) =>
                      updateSettings(
                        isFull ? { fullUseChunks: e.target.checked } : { skimUseChunks: e.target.checked },
                      )
                    }
                  />
                  带本机词块
                </label>
                <span className="muted">
                  {useChunks
                    ? '会从本机词 / 词组 / 习语里抽目标块，选句时要求用上。'
                    : isFull
                      ? '不查词库；纯随机主题，适合先放松地产出。'
                      : '不查词库；只围绕主题写。打开后就和全脂一样抽本机词块。'}
                </span>
              </div>

              <div className="production-field">
                <span className="muted">角度 / 语气</span>
                <div className="bar">
                  <select
                    aria-label="产出的角度"
                    value={settings.angle}
                    onChange={(e) => updateSettings({ angle: e.target.value as typeof settings.angle })}
                  >
                    {PRODUCTION_ANGLES.map((a) => (
                      <option key={a} value={a}>
                        {PRODUCTION_ANGLE_LABEL[a]}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="产出的语气"
                    value={settings.tone}
                    onChange={(e) => updateSettings({ tone: e.target.value as typeof settings.tone })}
                  >
                    {PRODUCTION_TONES.map((t) => (
                      <option key={t} value={t}>
                        {PRODUCTION_TONE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                  {useChunks && (
                    <select
                      aria-label="目标词块范围"
                      value={settings.scope}
                      onChange={(e) => updateSettings({ scope: e.target.value as typeof settings.scope })}
                    >
                      <option value="article">本篇（有上下文）</option>
                      <option value="all">全库（练迁移）</option>
                    </select>
                  )}
                </div>
              </div>

              {useChunks && (
                <div className="production-field">
                  <span className="muted">目标块类型</span>
                  <div className="bar">
                    {PRODUCTION_TARGET_TYPES.map((kind) => (
                      <label className="check-inline" key={kind}>
                        <input
                          type="checkbox"
                          checked={settings.types.includes(kind)}
                          onChange={(e) => toggleType(kind, e.target.checked)}
                        />
                        {TARGET_TYPE_LABEL[kind]}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="production-field">
                <span className="muted">本轮配置</span>
                <div className="bar">
                  <RoundSizeSelect
                    ariaLabel="本轮题目数"
                    label="题目"
                    value={settings.promptCount}
                    options={PRODUCTION_PROMPT_COUNTS}
                    onChange={(n) => updateSettings({ promptCount: n })}
                  />
                  {useChunks && (
                    <>
                      <RoundSizeSelect
                        ariaLabel="每题目标块数"
                        label="每题"
                        value={settings.targetsPerPrompt}
                        options={PRODUCTION_TARGETS_PER_PROMPT}
                        onChange={(n) => updateSettings({ targetsPerPrompt: n })}
                        unit="个"
                      />
                      <RoundSizeSelect
                        ariaLabel="薄弱词块比例"
                        label="薄弱"
                        value={settings.weakRatio}
                        options={PRODUCTION_WEAK_RATIOS}
                        onChange={(n) => updateSettings({ weakRatio: n })}
                        formatLabel={(n) => (n === 0 ? '不优先' : `${n}%`)}
                      />
                    </>
                  )}
                </div>
              </div>
            </>
          )}

          {model.error && <div className="production-error">{model.error}</div>}

          <div className="bar">
            <button
              className="primary"
              onClick={() => void model.start()}
              disabled={model.generating || !canStart}
            >
              {model.generating
                ? 'D老师出题中…'
                : isYogurt
                  ? '生成逐句拷打'
                  : settings.mode === 'full'
                    ? '全脂随机出题'
                    : '按主题出题'}
            </button>
            {model.generating && (
              <button onClick={model.cancelRun} title="停止等待 AI 返回">
                取消
              </button>
            )}
            <span className="muted">
              {isYogurt
                ? '逐句拆分在本机完成；批改仍走 AI，没配 key 时复制批改提示词粘回。'
                : '生成题目和批改会调用本机 AI；没配 key 时会复制提示词让你粘回。'}
            </span>
          </div>

          {showPaste && (
            <div className="production-paste">
              <div className="muted">
                {model.pasteKind === 'pack' ? '把 AI 返回的题目 JSON 粘到这里' : '把 AI 返回的批改 JSON 粘到这里'}
              </div>
              <textarea
                rows={6}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={
                  model.pasteKind === 'pack'
                    ? !useChunks
                      ? '{"prompts":[{"zh":"...","goal":"..."}]}'
                      : '{"prompts":[{"zh":"...","goal":"...","targetIds":["..."]}]}'
                    : '{"version":2,...}'
                }
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

          {model.history.length > 0 && (
            <div className="production-history">
              <b>最近的产出</b>
              {model.history.map((r) => {
                const task = isProductionTask(r.task) ? r.task : null
                const hits = productionHits(r.task)
                return (
                  <div className="production-history-row" key={r.recordKey ?? `${r.at}-${r.text.slice(0, 8)}`}>
                    <span>
                      {task?.mode ? `${PRODUCTION_MODE_LABEL[task.mode]} · ` : ''}
                      {writingRecordLabel(r)}
                    </span>
                    <span className="muted">{task?.topic || task?.task || ''}</span>
                    <span className="muted">
                      {r.feedback.total}/{r.feedback.max}
                      {hits.length ? ` · 目标块 ${hits.filter((h) => h.used).length}/${hits.length}` : ''}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {model.stage === 'playing' && model.current && (
        <div className="production-body">
          <div className="production-progress">
            <span>
              第 {model.index + 1} / {model.prompts.length} 题 · 第 {model.round} 稿
            </span>
            <span className="muted">
              {model.current.targets.length
                ? `目标块 ${model.current.targets.length} 个（答完再看具体是哪些）`
                : isYogurt
                  ? '风味酸奶 · 参考译文答完再看'
                  : isFull
                    ? '全脂随机主题 · 不限定目标块'
                    : '主题翻译 · 不限定目标块'}
            </span>
          </div>

          {model.notice && <div className="production-notice">{model.notice}</div>}

          <div className="production-prompt">
            <div className="production-zh">{model.current.zh}</div>
            {model.current.goal && <div className="muted">目标：{model.current.goal}</div>}
          </div>

          {!model.feedback && (
            <>
              {model.round === 2 && model.previousFeedback && (
                <details className="production-prev" open>
                  <summary>上一版批改（照着改，别原样再交）</summary>
                  {model.current.reference && (
                    <div className="production-reference">
                      <b>参考译文：</b>
                      {model.current.reference}
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
                    ? model.current.targets.length
                      ? '先自己写一版英文，不要先看答案…'
                      : isYogurt
                        ? '先自己翻译这句；参考译文在批改前不会出现…'
                        : isFull
                          ? '按随机主题自己写一版英文，不要先看答案…'
                          : '围绕主题自己写一版英文，不要先看答案…'
                    : model.current.targets.length
                      ? '按批改意见重写一版；目标块仍然要用上。'
                      : isYogurt
                        ? '按批改意见重写一版；对照参考译文改得更自然。'
                        : '按批改意见重写一版，写得更自然。'
                }
                disabled={model.grading || model.generating}
              />
              <div className="bar">
                <button
                  className="primary"
                  onClick={() => void model.grade()}
                  disabled={!model.answer.trim() || model.grading || model.generating}
                >
                  {model.grading ? '批改中…' : model.round === 1 ? '批改这一稿' : '提交重写并批改'}
                </button>
                {model.grading && <button onClick={model.cancelRun}>取消</button>}
              </div>
            </>
          )}

          {model.feedback && (
            <div className="production-review">
              {model.current.reference && (
                <div className="production-reference">
                  <b>参考译文：</b>
                  {model.current.reference}
                </div>
              )}
              <GoldenFeedback feedback={model.feedback} />
              {model.hits.length > 0 && (
                <div className="production-hits">
                  <b>目标块：</b>
                  {model.hits.map((h) => (
                    <span key={h.id} className={h.used ? 'ok' : 'bad'}>
                      {h.text}：{h.used ? '用上了' : '没用上'}
                      {h.meaning ? `（${h.meaning}）` : ''}
                    </span>
                  ))}
                </div>
              )}
              <div className="bar">
                {model.round < 2 ? (
                  <button className="primary" onClick={model.rewrite}>
                    按批改意见重写一版
                  </button>
                ) : (
                  <button className="primary" onClick={model.next}>
                    下一题
                  </button>
                )}
              </div>
            </div>
          )}

          {model.error && <div className="production-error">{model.error}</div>}

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
      )}

      {model.stage === 'done' && (
        <div className="production-body production-done">
          <b>这一组收工了 🐄</b>
          <p className="muted">已经把草嚼成奶了。下一组可以换模式 / 主题，或者把今天的句子再说一遍。</p>
          <div className="bar">
            <button className="primary" onClick={model.restart}>
              再来一组
            </button>
            <button onClick={model.close}>回到阅读</button>
          </div>
        </div>
      )}
    </div>
  )
}
