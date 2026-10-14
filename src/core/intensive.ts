/**
 * 精读工作流：把「一篇材料」拆成几个阶段，按当前数据算出各阶段状态、深度等级与下一步。
 *
 * 纯函数，不碰 React / 存储；UI 只负责画出来并按 key 跳转到对应工具。
 *
 * 阶段（从浅到深）：
 *   skim       通读（速读一遍，判断能不能看懂）
 *   vocab      标词 / 查词补齐（音标·释义·例句）
 *   chunks     词块（词组 / 习语 / 搭配）
 *   comprehend 句子理解（逐句译文 + 语言点）
 *   recall     达标拷打（背单词 + 拼写/选义，把词变成长期记忆）
 *   produce    产出（仿写 + 批改）
 *   grammar    语法专项（结构 / 语态时态 / 功能词）
 */

export interface SkillStat {
  total: number
  correct: number
}

export interface IntensiveWords {
  /** 本篇生词总数 */
  total: number
  /** 有中文释义的 */
  withMeaning: number
  /** 有词块（用法 / 词组 / 习语）的 */
  withChunks: number
  /** 有语法标记（可数/及物…）的 */
  withMarks: number
  /** 学过（repetitions > 0）的 */
  studied: number
  /** 已稳定掌握的 */
  stable: number
  /** 当前到期（含逾期）的 */
  due: number
  /** 还没有「自己的例句」的 */
  noExample: number
}

export interface IntensiveInput {
  hasDoc: boolean
  /** 通读是否已勾选（主观，本地持久化）。 */
  skimmed: boolean
  words: IntensiveWords
  sentences: { total: number; translated: number; language: number }
  /** 本篇考试正确率（可选）。 */
  quiz?: SkillStat
  /** 本篇仿写条数。 */
  writes: number
}

export type IntensiveStageKey =
  | 'skim'
  | 'vocab'
  | 'chunks'
  | 'comprehend'
  | 'recall'
  | 'produce'
  | 'grammar'

export interface IntensiveStage {
  key: IntensiveStageKey
  label: string
  emoji: string
  status: 'todo' | 'doing' | 'done'
  /** 0–100 */
  progress: number
  detail: string
  /** 主按钮文案 */
  action: string
  /** 是否已具备做这一步的条件（用于禁用按钮） */
  enabled: boolean
}

export interface IntensivePlan {
  stages: IntensiveStage[]
  /** 0 及格 / 1 达标 / 2 产出 / 3 精通 */
  level: 0 | 1 | 2 | 3
  levelLabel: string
  levelDesc: string
  /** 所有阶段的平均完成度 */
  progress: number
  nextKey: IntensiveStageKey | null
  nextLabel: string
  nextHint: string
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))
const pct = (a: number, b: number): number => (b > 0 ? clamp(Math.round((a / b) * 100)) : 0)
const statusOf = (p: number): 'todo' | 'doing' | 'done' => (p >= 100 ? 'done' : p > 0 ? 'doing' : 'todo')

const ACTION: Record<IntensiveStageKey, string> = {
  skim: '去速读',
  vocab: '补齐音标 / 释义',
  chunks: '补词组 / 习语',
  comprehend: '逐句翻译 / 语言点',
  recall: '去背单词',
  produce: '去仿写',
  grammar: '练结构 / 语法',
}

/** 由当前数据算出精读工作流。 */
export function buildIntensivePlan(i: IntensiveInput): IntensivePlan {
  const w = i.words
  const s = i.sentences
  const quizAcc = i.quiz && i.quiz.total > 0 ? pct(i.quiz.correct, i.quiz.total) : null
  const hasWords = w.total > 0

  // ── 通读 ──
  const skimP = i.skimmed ? 100 : 0
  // ── 标词 / 查词 ──
  const vocabP = hasWords ? pct(w.withMeaning, w.total) : 0
  // ── 词块 ──
  const chunksP = hasWords ? pct(w.withChunks, w.total) : 0
  // ── 句子理解 ──
  const compP = s.total > 0 ? clamp(Math.round(((s.translated + s.language) / (2 * s.total)) * 100)) : 0
  // ── 达标拷打 ──
  const studiedP = hasWords ? pct(w.studied, w.total) : 0
  const recallP = hasWords ? Math.round(studiedP * 0.5 + (quizAcc ?? studiedP) * 0.5) : 0
  const recallDone = hasWords && w.studied >= w.total && (quizAcc === null || quizAcc >= 80)
  // ── 产出 ──
  const produceP = i.writes > 0 ? 100 : 0
  // ── 语法专项 ──
  const grammarP = s.total > 0 ? pct(s.language, s.total) : 0

  const stages: IntensiveStage[] = [
    {
      key: 'skim',
      label: '通读',
      emoji: '👀',
      status: statusOf(skimP),
      progress: skimP,
      detail: i.skimmed ? '已通读（能看懂大意）' : '先用速读过一遍，标出卡住的句子',
      action: ACTION.skim,
      enabled: i.hasDoc,
    },
    {
      key: 'vocab',
      label: '标词 / 查词',
      emoji: '🔍',
      status: statusOf(vocabP),
      progress: vocabP,
      detail: hasWords
        ? `${w.withMeaning}/${w.total} 有释义${w.noExample ? ` · ${w.noExample} 个缺例句` : ''}`
        : '还没有生词：选词 / 自动标词，再一键跑批',
      action: ACTION.vocab,
      enabled: i.hasDoc,
    },
    {
      key: 'chunks',
      label: '词块',
      emoji: '🧩',
      status: statusOf(chunksP),
      progress: chunksP,
      detail: hasWords ? `${w.withChunks}/${w.total} 有词组/搭配` : '先建生词，再补词组/习语',
      action: ACTION.chunks,
      enabled: hasWords,
    },
    {
      key: 'comprehend',
      label: '句子理解',
      emoji: '📖',
      status: statusOf(compP),
      progress: compP,
      detail: s.total > 0 ? `译文 ${s.translated}/${s.total} · 语言点 ${s.language}/${s.total}` : '没有句子',
      action: ACTION.comprehend,
      enabled: i.hasDoc,
    },
    {
      key: 'recall',
      label: '达标拷打',
      emoji: '🥊',
      status: recallDone ? 'done' : statusOf(recallP),
      progress: recallDone ? 100 : recallP,
      detail: hasWords
        ? `学过 ${w.studied}/${w.total} · 稳定 ${w.stable}${w.due ? ` · 到期 ${w.due}` : ''}${
            quizAcc !== null ? ` · 考试 ${quizAcc}%` : ''
          }`
        : '先建生词，再来拷打',
      action: ACTION.recall,
      enabled: hasWords,
    },
    {
      key: 'produce',
      label: '产出（仿写）',
      emoji: '✍️',
      status: statusOf(produceP),
      progress: produceP,
      detail: i.writes > 0 ? `已仿写 ${i.writes} 条` : '挑一个好句式，自己写一句再让 AI 批改',
      action: ACTION.produce,
      enabled: i.hasDoc,
    },
    {
      key: 'grammar',
      label: '语法专项',
      emoji: '🧠',
      status: statusOf(grammarP),
      progress: grammarP,
      detail:
        s.total > 0
          ? `语言点 ${s.language}/${s.total} 句${hasWords && w.withMarks ? ` · 语法标记 ${w.withMarks} 词` : ''}`
          : '没有句子',
      action: ACTION.grammar,
      enabled: i.hasDoc,
    },
  ]

  const stage = (k: IntensiveStageKey) => stages.find((x) => x.key === k)!
  const isDone = (k: IntensiveStageKey) => stage(k).status === 'done'

  const passed = isDone('skim')
  const solid = passed && isDone('vocab') && compP >= 90 && stage('recall').progress >= 60
  const productive = solid && isDone('produce')
  const mastered = productive && isDone('chunks') && isDone('recall') && isDone('grammar')
  const level: IntensivePlan['level'] = mastered ? 3 : productive ? 2 : solid ? 1 : 0

  const progress = Math.round(stages.reduce((a, x) => a + x.progress, 0) / stages.length)
  const next = stages.find((x) => x.status !== 'done') ?? null

  const LEVEL_LABEL = ['及格', '达标', '产出', '精通']
  const LEVEL_DESC = [
    '看懂了 → 下一步把生词和句子收干净',
    '词记住了、句子懂了 → 下一步开始产出',
    '能仿写了 → 下一步把词块和语法也吃透',
    '词块 · 语法 · 产出都到位，隔天复习即可',
  ]
  const NEXT_HINT: Record<IntensiveStageKey, string> = {
    skim: '先速读一遍，只求看懂大意、标出卡住的句子',
    vocab: '把卡住句子里的生词选进「待选」，再点「⚡ 一键跑批」补齐音标/释义/例句',
    chunks: '一键跑批会自动生成词组/习语；背单词时的「写搭配」就是在记词块',
    comprehend: '点「全文翻译」和「语言点」，先自己译、再对答案',
    recall: '用「记忆拷打 / 词块拷打」快速过，再进背单词按 SRS 复习',
    produce: '挑一个你划出来的好句式，自己写一句，让 AI 严格批改',
    grammar: '点「语言点」看结构/语法，再用文章测验的「结构/语法 · 中译英」巩固',
  }

  const nextKey = next?.key ?? null
  return {
    stages,
    level,
    levelLabel: LEVEL_LABEL[level],
    levelDesc: LEVEL_DESC[level],
    progress,
    nextKey,
    nextLabel: next ? `${next.label} · ${next.action}` : '本篇已精读到位 🎉',
    nextHint: nextKey ? NEXT_HINT[nextKey] : '隔天按到期复习，或换一篇新材料',
  }
}
