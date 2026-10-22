import type { VocabItem, VocabLibrary } from '../../types/document'
import type { ReviewGrade } from './review'

/**
 * 「学习新单词」里 4 条中文释义这一步的判定（纯函数）。
 *
 * 为什么单独一个文件：这一步的规则和复习侧的「认识 / 模糊 / 忘记了」不是一回事——
 * 它多了一个「你有没有看答案」的信号，判定结果也不一样：
 *
 *   - 点了「看答案」    → 不认识（again）；先高亮正确释义停留一下，再进单词卡
 *   - 没看答案、选错    → 不认识（again）；正确标浅绿、你选的那个标浅红，点「继续」才进单词卡
 *   - 没看答案、选对    → 首次「模糊」（hard），第二次起「认识」（good）；直接进单词卡
 *
 * 「首次只给模糊」是刻意的：四个选项里蒙对的概率不低，
 * 只有**下次又选对一次**才说明真记住了（次数记在 `ReviewState.meaningPasses`，跨轮持久）。
 *
 * 判定之后不管走哪条路，**都要进单词卡**：看一遍释义/例句/用法，
 * 既是防蒙对，也是把这一次出场变成一次真正的记忆动作（Spec 要求）。
 */

/** 点了「看答案」后，先高亮正确释义停留多久（ms）再切到单词卡。期间点击 / 按键可打断。 */
export const LEARN_REVEAL_HOLD_MS = 600

/** 学习模式这一步用户做了什么。 */
export type LearnAction = 'reveal' | 'correct' | 'wrong'

export interface LearnStepInput {
  action: LearnAction
  /** 这个词此前「没看答案就选对」过几次（`ReviewState.meaningPasses`，脏值按 0）。 */
  passes: number
  /** 词库够不够出「正确 + 3 干扰项」；不够就退回现有的普通卡片流程。 */
  canQuiz: boolean
}

export type LearnStep =
  /** 词库不够 4 个选项（< 4 个不同释义）：退回「看词 → 显示释义 → 三档评分」。 */
  | { kind: 'fallback' }
  /** 停在释义页高亮：正确项浅绿；选错时你点的那项浅红。**不评分、不换页**。 */
  | {
      kind: 'hold'
      grade: ReviewGrade
      /** true = 停留 `LEARN_REVEAL_HOLD_MS` 后自动进单词卡（看答案）；false = 等用户点「继续」（选错）。 */
      auto: boolean
      /** 是否连你选错的那项一起标红。 */
      wrong: boolean
      label: string
    }
  /** 直接进单词卡（选对了）。 */
  | { kind: 'card'; grade: ReviewGrade; pass: boolean; label: string }

/** 脏值（NaN / 负数 / 小数 / 字符串）一律按「没选对过」算。 */
export function normPasses(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** 这个词「没看答案就选对」过几次。 */
export function meaningPassesOf(item: VocabItem): number {
  return normPasses(item?.reviewState?.meaningPasses)
}

/**
 * 下一次该记几次：选对 +1；判为不认识（看答案 / 选错 / 拼错）**归零**——
 * 都从头学，不再享受「上次选对过」的信用。
 */
export function nextMeaningPasses(passes: unknown, pass: boolean): number {
  return pass ? normPasses(passes) + 1 : 0
}

/**
 * 判定这一步。规则见文件头；`canQuiz` 为假时不做判定（UI 退回普通卡）。
 */
export function gradeLearnStep(input: LearnStepInput): LearnStep {
  if (!input.canQuiz) return { kind: 'fallback' }
  const passes = normPasses(input.passes)
  switch (input.action) {
    case 'reveal':
      return { kind: 'hold', grade: 'again', auto: true, wrong: false, label: '不认识 · 看了答案' }
    case 'wrong':
      return { kind: 'hold', grade: 'again', auto: false, wrong: true, label: '不认识 · 选错了' }
    case 'correct':
    default: {
      const grade: ReviewGrade = passes > 0 ? 'good' : 'hard'
      return {
        kind: 'card',
        grade,
        pass: true,
        label: grade === 'good' ? '认识 · 又选对一次' : '模糊 · 第一次选对',
      }
    }
  }
}

/**
 * 把「选对次数」写回词库（只改这一条，其它条目保持原引用）。
 *
 * 记 0 时不写这个字段（跟 `relearn` 一个口径：老数据里没有就等于 0），
 * 免得每次判定都给全库条目硬塞一个字段。
 */
export function recordLearnPass(
  library: VocabLibrary,
  id: string,
  pass: boolean,
  now: Date = new Date(),
): VocabLibrary {
  const cur = library.items.find((it) => it.id === id)
  if (!cur) return library
  const next = nextMeaningPasses(meaningPassesOf(cur), pass)
  const had = cur.reviewState.meaningPasses
  if (next === (typeof had === 'number' ? had : 0)) return library
  return {
    ...library,
    items: library.items.map((it) => {
      if (it.id !== id) return it
      const { meaningPasses: _drop, ...rest } = it.reviewState
      return {
        ...it,
        reviewState: next > 0 ? { ...rest, meaningPasses: next } : rest,
        updatedAt: now.toISOString(),
      }
    }),
  }
}
