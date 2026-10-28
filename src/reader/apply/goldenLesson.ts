import { buildLocalGoldenLesson } from '../../core/golden'
import { mergeGoldenLessons, parseGoldenLesson } from '../../core/goldenAi'
import type { ApplyContext, ApplyOutcome } from './types'

/**
 * D老师小课堂：AI 金句课写回文章；应用前校验文章，避免切篇后写错。
 * 目标句 / 学习点的清洗在 `core/goldenAi`，这里只负责合并与回执。
 */
export function applyGoldenLesson(ctx: ApplyContext): ApplyOutcome {
  const { doc, meta, articleKey, setDoc, setPendingSave } = ctx
  if (!doc || !doc.sentences.length) return { report: ['先打开一篇文章'], missing: null, ok: false }
  if (meta?.articleKey && articleKey && meta.articleKey !== articleKey) {
    return { report: ['文章已切换，这份金句结果未应用；切回原文章再贴一次'], missing: null, ok: false }
  }

  const lesson = parseGoldenLesson(ctx.text, doc.sentences)
  if (!lesson) {
    return {
      report: ['没解析出金句课（需要 JSON：{summary, outline, selected, sentences:[{id, targets}]}）；坏目标会被丢掉'],
      missing: null,
      ok: false,
    }
  }

  setDoc((d) => {
    if (!d) return d
    const local = buildLocalGoldenLesson(d.sentences, d.paragraphs, { selected: d.golden?.selected ?? [] })
    const merged = mergeGoldenLessons(local, lesson, d.sentences, {
      preferAI: !d.golden || d.golden.source === 'local',
      dedupe: d.golden?.options?.dedupe,
    })
    return { ...d, golden: merged }
  })
  setPendingSave(true)
  const targetCount = lesson.sentences.reduce((n, s) => n + s.targets.length, 0)
  return {
    report: [
      `已生成 D老师小课堂：${lesson.sentences.length} 句 / ${targetCount} 个学习点`,
      '打开顶栏「D老师小课堂」开始练；已掌握进度按句子内容指纹保留',
    ],
    missing: null,
    ok: true,
  }
}
