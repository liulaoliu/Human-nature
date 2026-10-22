/**
 * 「强制锤炼」什么时候该出现（纯函数）。
 *
 * 锤炼是**评分门禁**：卡停太久、或重学卡摊开了释义，得先做一道题（拼写 / 选义 / 搭配 / 听写）
 * 才能评分。既然是门禁，三种情况必须排除在外：
 *
 *   - 已经判完、停在卡上等「下一词」(`parked`)：分都落库了，再考一次也解锁不了什么，
 *     插进来只会把「看一眼单词卡和释义」这件事顶掉。
 *   - 学习模式「4 条释义」这一关 (`learnPhase`)：那一步本身就是一次释义考试，
 *     再叠一遍等于同一个词连考两次。
 *   - 拼错判定页 (`spellMiss`)：整页都在看「判错卡」，等用户按空格确认。
 *
 * 反面案例（2026-10-22 修）：学习模式选错释义 → 判 again → 这个词立刻成了「重学中」，
 * 于是点「继续（看单词卡）」的同一帧就命中重学分支，单词卡一帧都没露就被锤炼接管了。
 * 复习模式按「忘记了」也一样：判完直接跳锤炼，看不到「下一词 + 答案」。
 */

export interface DrillInput {
  /** 有没有在背（没开始 / 本轮结束 → 不锤炼）。 */
  active: boolean
  /** 拼错判定中。 */
  spellMiss: boolean
  /** 学习模式「4 条释义」这一关进行中。 */
  learnPhase: boolean
  /** 这一卡已经判过、停在卡上等「下一词」（学习判完 / 复习已判 / 模糊待定）。 */
  parked: boolean
  /** 卡停超时（阈值在外面算：`drillAfter > 0 && 秒数 >= drillAfter`，且本轮还没锤炼过）。 */
  timedOut: boolean
  /** 重学卡已经摊开释义：要先过一道题才算过。 */
  relearnRevealed: boolean
  /**
   * 这一卡**本轮已经锤炼过**（全过、解锁了评分）。过完就收工，别再拦。
   *
   * 2026-10-22 修的坑：重学卡的 `relearnRevealed` 只看「摊开过释义」，而摊开之后就一直是 true ——
   * 过完锤炼面板会立刻原地重开，用户写完搭配也退不出去（超时那条有 `!drillCleared` 兜着，
   * 只有重学这条没有）。所以「过没过」必须由这里兜，而不是让两条触发各自记得。
   */
  cleared: boolean
}

export function shouldDrill(input: DrillInput): boolean {
  if (!input.active || input.spellMiss || input.learnPhase || input.parked || input.cleared) return false
  return input.timedOut || input.relearnRevealed
}
