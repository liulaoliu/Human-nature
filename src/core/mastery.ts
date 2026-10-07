/**
 * 文章掌握度：把「词 / 精读 / 技能 / 错题」几路信号合成一个 0–100 的分数，
 * 并给出各维度明细与「下一步」。纯函数，方便单测。
 *
 * 只服务 UI 展示与决策，不落库、不碰 React。
 */

export interface SkillStat {
  total: number
  correct: number
}

export interface MasteryInput {
  /** 本篇生词的掌握情况（由调用方按 SRS 判定）。 */
  words: {
    /** 本篇生词总数 */
    total: number
    /** 「稳定」的词数（repetitions/interval 达标且近期无错） */
    stable: number
    /** 当前到期（含逾期）的词数 */
    due: number
    /** 曾「忘记」过的词数 */
    lapsed: number
    /** 还没学过（repetitions=0）的词数 */
    fresh: number
  }
  /** 精读完成度。 */
  reading: {
    sentences: number
    translated: number
    language: number
  }
  /** 各技能最近正确率（调用方已按本篇过滤）。缺省表示还没练过。 */
  skills: {
    quiz?: SkillStat
    dictation?: SkillStat
    listening?: SkillStat
  }
  /** 错题本里属于本篇的条目数。 */
  mistakes: { words: number; sentences: number }
}

export interface MasteryDimension {
  key: string
  label: string
  /** 0–100；无数据维度不出现 */
  score: number
  detail: string
}

export interface ArticleMastery {
  /** 0–100 综合分 */
  score: number
  /** 文字档位：生 / 半熟 / 熟 / 很熟 */
  grade: string
  dimensions: MasteryDimension[]
  /** 下一步建议（一句） */
  next: string
  /** 综合分是否基于足够数据（没练过技能时提示“先做一轮”） */
  enough: boolean
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))
const ratio = (a: number, b: number): number | null => (b > 0 ? clamp(Math.round((a / b) * 100)) : null)

function gradeOf(score: number): string {
  if (score < 40) return '生'
  if (score < 65) return '半熟'
  if (score < 85) return '熟'
  return '很熟'
}

/** 由输入算文章掌握度。 */
export function buildArticleMastery(i: MasteryInput): ArticleMastery {
  const dims: MasteryDimension[] = []
  const w = i.words
  const wordScore = ratio(w.stable, w.total) ?? 0
  dims.push({
    key: 'words',
    label: '词汇',
    score: wordScore,
    detail: `${w.stable}/${w.total} 稳定` + (w.due ? ` · 到期 ${w.due}` : '') + (w.fresh ? ` · 未学 ${w.fresh}` : ''),
  })

  const r = i.reading
  const readScore = r.sentences > 0 ? clamp(Math.round(((r.translated + r.language) / (2 * r.sentences)) * 100)) : 0
  dims.push({
    key: 'reading',
    label: '精读',
    score: readScore,
    detail: `译文 ${r.translated}/${r.sentences} · 语言点 ${r.language}/${r.sentences}`,
  })

  // 技能维度：有几个算几个，平均后占 35 分权重
  const skills: { key: string; label: string; stat: SkillStat }[] = []
  if (i.skills.quiz && i.skills.quiz.total > 0) skills.push({ key: 'skill-quiz', label: '考试', stat: i.skills.quiz })
  if (i.skills.dictation && i.skills.dictation.total > 0) skills.push({ key: 'skill-dictation', label: '听写', stat: i.skills.dictation })
  if (i.skills.listening && i.skills.listening.total > 0) skills.push({ key: 'skill-listening', label: '理解', stat: i.skills.listening })
  for (const s of skills) {
    const sc = ratio(s.stat.correct, s.stat.total) ?? 0
    dims.push({ key: s.key, label: s.label, score: sc, detail: `${s.stat.correct}/${s.stat.total}（${sc}%）` })
  }

  // 加权：词汇 45、精读 20、技能 35（技能内部平均）；实际存在的权重归一化
  let acc = 45 * wordScore + 20 * readScore
  let wsum = 65
  if (skills.length) {
    const avg = skills.reduce((a, s) => a + (ratio(s.stat.correct, s.stat.total) ?? 0), 0) / skills.length
    acc += 35 * avg
    wsum += 35
  }
  let score = Math.round(acc / wsum)

  // 错题惩罚（最多 10 分）
  const penalty = Math.min(10, i.mistakes.words * 2 + i.mistakes.sentences)
  score = clamp(score - penalty)

  const enough = skills.length > 0 && w.total > 0

  // 下一步：挑最弱的一环
  let next = ''
  const weakest = [...dims].sort((a, b) => a.score - b.score)[0]
  if (!w.total) next = '先「自动标词 / 选词」把本篇生词建起来'
  else if (!skills.length) next = '做一轮「考试/听写/理解」，掌握度才有技能数据'
  else if (w.fresh > 0) next = `还有 ${w.fresh} 个词没学过，先「背单词」`
  else if (w.due > 0) next = `有 ${w.due} 个词到期，先「背单词」清一轮`
  else if (weakest && weakest.score < 70) next = `最弱是「${weakest.label}」（${weakest.score}%），针对它再练一轮`
  else next = '状态不错，隔天按到期复习即可'

  return { score, grade: gradeOf(score), dimensions: dims, next, enough }
}

/** 判定一个词条是否「稳定掌握」：复习次数够、间隔够、且没在最近出错。 */
export function isStable(item: { reviewState: { repetitions: number; interval: number; lapses?: number } }): boolean {
  const rs = item.reviewState
  return rs.repetitions >= 2 && rs.interval >= 6 && (rs.lapses ?? 0) === 0
}
