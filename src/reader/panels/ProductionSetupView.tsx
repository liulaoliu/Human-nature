import { useState } from 'react'
import { KIND_LABEL } from '../../core/entryKind'
import {
  PRODUCTION_ANGLE_LABEL,
  PRODUCTION_ANGLES,
  PRODUCTION_LEVEL_LABEL,
  PRODUCTION_LEVELS,
  PRODUCTION_MODE_DESC,
  PRODUCTION_MODE_LABEL,
  PRODUCTION_MODES,
  PRODUCTION_PROMPT_COUNTS,
  PRODUCTION_SCOPES,
  PRODUCTION_SCOPE_LABEL,
  PRODUCTION_TARGETS_PER_PROMPT,
  PRODUCTION_TARGET_TYPES,
  PRODUCTION_TONE_LABEL,
  PRODUCTION_TONES,
  PRODUCTION_VARIANT_LABEL,
  PRODUCTION_VARIANTS,
  PRODUCTION_WEAK_RATIOS,
  type ProductionTargetKind,
} from '../../core/production'
import {
  isProductionTask,
  pairYogurtTexts,
  productionHits,
  type YogurtPair,
} from '../../core/productionPrompts'
import { writingRecordLabel } from '../../core/writing'
import type { useProductionSession } from '../hooks/useProductionSession'
import RoundSizeSelect from './RoundSizeSelect'

type ProductionModel = ReturnType<typeof useProductionSession>

/** 选草料阶段真正要用的字段（窄接口，不是整包 model）。 */
export type ProductionSetupModel = Pick<
  ProductionModel,
  | 'settings'
  | 'updateSettings'
  | 'generating'
  | 'error'
  | 'pasteKind'
  | 'pendingPrompt'
  | 'history'
  | 'legacyMigration'
  | 'start'
  | 'startYogurtPairs'
  | 'applyPaste'
  | 'copyPromptAgain'
  | 'cancelRun'
>

const TOPIC_PRESETS = ['工作沟通', '旅行见闻', '表达观点', '生活小事']

const TARGET_TYPE_LABEL: Record<ProductionTargetKind, string> = {
  word: KIND_LABEL.word,
  phrase: `${KIND_LABEL.phrase} / 搭配`,
  idiom: KIND_LABEL.idiom,
}

export interface ProductionSetupViewProps {
  model: ProductionSetupModel
}

/**
 * 选草料：模式 / 主题 / 目标块 / 风味酸奶拆句 / 最近的产出。
 *
 * 只做这一屏的表单状态（粘回框内容、逐句配对），出题与校验都在 `useProductionSession`。
 */
export default function ProductionSetupView({ model }: ProductionSetupViewProps) {
  const [pasteText, setPasteText] = useState('')
  const [yogurtPairs, setYogurtPairs] = useState<YogurtPair[] | null>(null)
  const [pairWarning, setPairWarning] = useState('')
  const [pairError, setPairError] = useState('')
  const { settings, updateSettings } = model
  const pastePrompt = model.pendingPrompt
  const activeMode = settings.mode
  const isYogurt = activeMode === 'yogurt'
  const isSkim = activeMode === 'skim'
  const isFull = activeMode === 'full'
  const useChunks = isYogurt ? false : isFull ? settings.fullUseChunks : settings.skimUseChunks
  const showPaste = !!model.pasteKind && !(isYogurt && model.pasteKind === 'pack')
  const legacyReport = model.legacyMigration?.report
  const canStart = isYogurt
    ? !!settings.sourceText.trim() &&
      !!settings.referenceText.trim() &&
      (!yogurtPairs || yogurtPairs.some((p) => p.source.trim() || p.reference.trim()))
    : isSkim
      ? !!settings.topic.trim() && (!useChunks || !!settings.types.length)
      : !useChunks || !!settings.types.length

  const sourceLabel = settings.yogurtDirection === 'en-zh' ? '原文（英文）' : '原文（中文）'
  const referenceLabel = settings.yogurtDirection === 'en-zh' ? '参考译文（中文）' : '参考译文（英文）'

  const toggleType = (kind: ProductionTargetKind, on: boolean) => {
    const types = on ? [...new Set([...settings.types, kind])] : settings.types.filter((t) => t !== kind)
    updateSettings({ types })
  }

  const invalidatePairs = () => {
    setYogurtPairs(null)
    setPairWarning('')
    setPairError('')
  }

  const previewYogurt = () => {
    const result = pairYogurtTexts(settings.sourceText, settings.referenceText, settings.yogurtSplit)
    if (!result) {
      setPairError('两边都要有内容，才能拆句')
      return
    }
    setYogurtPairs(result.pairs)
    setPairWarning(result.warning)
    setPairError('')
  }

  const updatePair = (index: number, patch: Partial<YogurtPair>) => {
    setYogurtPairs((prev) => prev?.map((p, i) => (i === index ? { ...p, ...patch } : p)) ?? null)
  }

  const movePair = (index: number, delta: number) => {
    setYogurtPairs((prev) => {
      if (!prev) return prev
      const next = [...prev]
      const to = index + delta
      if (to < 0 || to >= next.length) return prev
      ;[next[index], next[to]] = [next[to], next[index]]
      return next
    })
  }

  const deletePair = (index: number) => {
    setYogurtPairs((prev) => prev?.filter((_, i) => i !== index) ?? null)
  }

  const mergeNextPair = (index: number) => {
    setYogurtPairs((prev) => {
      if (!prev || index + 1 >= prev.length) return prev
      const next = [...prev]
      next[index] = {
        source: `${next[index].source} ${next[index + 1].source}`.trim(),
        reference: `${next[index].reference} ${next[index + 1].reference}`.trim(),
      }
      next.splice(index + 1, 1)
      return next
    })
  }

  const splitPair = (index: number) => {
    setYogurtPairs((prev) => {
      if (!prev) return prev
      const pair = prev[index]
      const result = pairYogurtTexts(pair.source, pair.reference, 'sentence')
      if (!result || (result.sourceCount <= 1 && result.referenceCount <= 1)) return prev
      const next = [...prev]
      next.splice(index, 1, ...result.pairs)
      return next
    })
  }

  return (
    <div className="production-body">
      <div className="production-hero">
        <b>把想说的话，真的写成英文。</b>
        <span className="muted">三种吃法：全脂随机、脱脂奶按主题、风味酸奶逐句翻译；批改后再重写一版。</span>
      </div>

      {legacyReport && (
        <details className="production-legacy">
          <summary>
            旧产出记录已归组：{legacyReport.changed} 条 /{' '}
            {legacyReport.groups.length} 组（原历史有本机备份）
          </summary>
          <ul>
            {legacyReport.groups.slice(0, 6).map((group) => (
              <li key={group.sessionId}>
                {group.articleId} · {group.day} · {group.mode} · {group.topic || '未命名主题'} ·{' '}
                {group.count} 条
              </li>
            ))}
          </ul>
          {legacyReport.groups.length > 6 && (
            <p className="muted">还有 {legacyReport.groups.length - 6} 组未展开。</p>
          )}
          <p className="muted">备份键：{legacyReport.backupKey}</p>
        </details>
      )}

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
          <div className="bar">
            <select
              aria-label="风味酸奶方向"
              value={settings.yogurtDirection}
              onChange={(e) => {
                updateSettings({ yogurtDirection: e.target.value as typeof settings.yogurtDirection })
                invalidatePairs()
              }}
            >
              <option value="zh-en">中 → 英</option>
              <option value="en-zh">英 → 中</option>
            </select>
            <select
              aria-label="风味酸奶拆句方式"
              value={settings.yogurtSplit}
              onChange={(e) => {
                updateSettings({ yogurtSplit: e.target.value as typeof settings.yogurtSplit })
                invalidatePairs()
              }}
            >
              <option value="sentence">按句号拆</option>
              <option value="line">按换行拆</option>
            </select>
            <button onClick={previewYogurt}>预览配对</button>
            <label className="check-inline">
              <input
                type="checkbox"
                checked={settings.yogurtParagraph}
                onChange={(e) => updateSettings({ yogurtParagraph: e.target.checked })}
              />
              最后加整段连写
            </label>
          </div>
          <span className="muted">{sourceLabel}</span>
          <textarea
            aria-label="风味酸奶原文"
            rows={7}
            value={settings.sourceText}
            onChange={(e) => {
              updateSettings({ sourceText: e.target.value })
              invalidatePairs()
            }}
            placeholder={
              settings.yogurtDirection === 'en-zh'
                ? '把值得背的英文原句 / 段落粘到这里…'
                : '把在网上看到、值得背的中文段落粘到这里…'
            }
          />
          <span className="muted">{referenceLabel}（答完 / 批改前不会显示）</span>
          <textarea
            aria-label="风味酸奶参考译文"
            rows={7}
            value={settings.referenceText}
            onChange={(e) => {
              updateSettings({ referenceText: e.target.value })
              invalidatePairs()
            }}
            placeholder={
              settings.yogurtDirection === 'en-zh'
                ? '把 Google 翻译 / 其他中文参考译文粘到这里…'
                : '把 Google 翻译 / 其他英文参考译文粘到这里…'
            }
          />
          <span className="muted">
            可以按段落粘贴；先拆句预览，再手动合并 / 拆开 / 调整顺序。逐句练习在本机完成，不需要 AI 出题。
          </span>
          {pairError && <div className="production-error">{pairError}</div>}
          {pairWarning && <div className="production-notice">{pairWarning}</div>}
          {yogurtPairs && (
            <div className="production-pairs">
              {yogurtPairs.map((pair, i) => (
                <div className="production-pair" key={`${i}-${pair.source.slice(0, 8)}`}>
                  <div className="muted">第 {i + 1} 对</div>
                  <textarea
                    aria-label={`第${i + 1}对原文`}
                    rows={2}
                    value={pair.source}
                    onChange={(e) => updatePair(i, { source: e.target.value })}
                    placeholder={sourceLabel}
                  />
                  <textarea
                    aria-label={`第${i + 1}对参考译文`}
                    rows={2}
                    value={pair.reference}
                    onChange={(e) => updatePair(i, { reference: e.target.value })}
                    placeholder={referenceLabel}
                  />
                  <div className="bar">
                    <button onClick={() => movePair(i, -1)} disabled={i === 0}>
                      上移
                    </button>
                    <button onClick={() => movePair(i, 1)} disabled={i === yogurtPairs.length - 1}>
                      下移
                    </button>
                    <button onClick={() => mergeNextPair(i)} disabled={i === yogurtPairs.length - 1}>
                      合并下一对
                    </button>
                    <button onClick={() => splitPair(i)}>拆成两句</button>
                    <button onClick={() => deletePair(i)}>删除</button>
                  </div>
                </div>
              ))}
              <button
                onClick={() =>
                  setYogurtPairs((prev) => [...(prev ?? []), { source: '', reference: '' }])
                }
              >
                ＋ 加一对
              </button>
            </div>
          )}
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
              <select
                aria-label="产出难度"
                value={settings.level}
                onChange={(e) => updateSettings({ level: e.target.value as typeof settings.level })}
              >
                {PRODUCTION_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {PRODUCTION_LEVEL_LABEL[level]}
                  </option>
                ))}
              </select>
              {useChunks && (
                <select
                  aria-label="产出题型"
                  value={settings.variant}
                  onChange={(e) => updateSettings({ variant: e.target.value as typeof settings.variant })}
                >
                  {PRODUCTION_VARIANTS.map((variant) => (
                    <option key={variant} value={variant}>
                      {PRODUCTION_VARIANT_LABEL[variant]}
                    </option>
                  ))}
                </select>
              )}
              {useChunks && (
                <select
                  aria-label="目标词块范围"
                  value={settings.scope}
                  onChange={(e) => updateSettings({ scope: e.target.value as typeof settings.scope })}
                >
                  {PRODUCTION_SCOPES.map((scope) => (
                    <option key={scope} value={scope}>
                      {PRODUCTION_SCOPE_LABEL[scope]}
                    </option>
                  ))}
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

      {model.error && (
        <div className="production-error">
          {model.error}{' '}
          <button
            onClick={() => void model.start()}
            title="用同一份设置再试一次"
          >
            重试
          </button>
        </div>
      )}

      <div className="bar">
        <button
          className="primary"
          onClick={() => {
            if (isYogurt) {
              if (yogurtPairs) model.startYogurtPairs(yogurtPairs, pairWarning)
              else previewYogurt()
            } else {
              void model.start()
            }
          }}
          disabled={model.generating || !canStart}
        >
          {model.generating
            ? 'D老师出题中…'
            : isYogurt
              ? yogurtPairs
                ? '开始逐句拷打'
                : '拆句预览'
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
  )
}
