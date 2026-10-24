/**
 * 「强制锤炼」什么时候该出现（纯函数）。
 *
 * 锤炼是**评分门禁**：卡停太久、或重学卡要评分了，得先做一道题（拼写 / 选义 / 搭配）
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
 * 复习模式按「忘记了」同样：判完直接跳锤炼，看不到「下一词 + 答案」。
 *
 * 反面案例（2026-10-24 修，用户报「一个新单词点『显示释义』就直接进锤炼」）：
 * 旧规则把「重学卡摊开释义」(`relearnRevealed`) 直接当成锤炼触发条件。摊开释义是**被动查看**
 * （用户只想知道这词什么意思），锤炼是**主动考核**（要他拼写 + 选义 + 写搭配）。
 * 两者混在一起的后果：点一下「显示释义」整页就被锤炼接管，**释义一帧都没露**；
 * 更糟的是重学标记来源极隐蔽（按一次 U「不认识」或 3「忘记了」就永久写上 `relearn`），
 * 用户压根不记得这个词被标过，于是表现为「莫名其妙就进锤炼」。
 *
 * 正确的分工：**摊开释义 = 给他看；要评分 = 才拦他做一道题**。
 * 所以 `relearnRevealed` 改成 `relearnScoring`：只有「重学卡 + 摊开过释义 + 此刻正要评分」
 * 才触发锤炼。平时摊开释义只是看，不拦。
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
  /**
   * 重学卡此刻**正要评分**（摊开过释义 + 用户点了认识/模糊/忘记了）。
   *
   * 注意这里从「摊开过释义」改成了「正要评分」：摊开是看，评分才是考核。
   * 摊开释义不再触发锤炼（用户报的「点显示释义就进锤炼」）。
   */
  relearnScoring: boolean
  /**
   * 这一卡**本轮已经锤炼过**（全过、解锁了评分）。过完就收工，别再拦。
   *
   * 2026-10-22 修的坑：重学卡的「摊开过释义」一旦为真就一直为真，过完锤炼面板会立刻原地重开，
   * 用户写完搭配也退不出去（超时那条有 `!drillCleared` 兜着，只有重学这条没有）。
   * 所以「过没过」必须由这里兜，而不是让两条触发各自记得。
   */
  cleared: boolean
}

/**
 * 锤炼的触发原因——界面要据此换标题（「超时锤炼」/「重学补考」），
 * 两者是**不同的门禁**，混成一句话用户会以为是自己点错了。
 */
export type DrillReason = 'timeout' | 'relearn'

/** 返回触发原因；null = 不锤炼。两条同时成立时算「超时」（更早发生、更好解释）。 */
export function drillReason(input: DrillInput): DrillReason | null {
  if (!input.active || input.spellMiss || input.learnPhase || input.parked || input.cleared) return null
  if (input.timedOut) return 'timeout'
  if (input.relearnScoring) return 'relearn'
  return null
}

/** 要不要进锤炼（只问「有没有」，原因见 `drillReason`）。 */
export function shouldDrill(input: DrillInput): boolean {
  return drillReason(input) !== null
}
