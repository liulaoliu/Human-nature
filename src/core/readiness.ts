/**
 * 仪表盘：把「听说读写」各能力当前是否可用、缺什么、下一步做什么，算成一张表。
 *
 * 纯函数，方便单测。UI 只负责把 rows 画出来，并按 key 挂上「去准备」的动作。
 *
 * level：
 *   - ready   已经能直接练
 *   - partial 能练，但数据不全（比如缺释义 / 听力题还没生成）
 *   - blocked 还练不了（比如没打开文章 / 词库是空的）
 */

export type ReadyLevel = 'ready' | 'partial' | 'blocked'

export interface ReadyInput {
  hasDoc: boolean
  /** 句子数 */
  sentences: number
  /** 已有译文的句子数 */
  translated: number
  /** 已有语言点的句子数 */
  language: number
  /** 听力理解题数量 */
  listenQuiz: number
  /** 词库词条数 */
  vocab: number
  /** 待选词数 */
  batch: number
  /** 未查词条数 */
  unqueried: number
  /** 缺释义词条数 */
  noMeaning: number
  /** 缺例句或用法词条数 */
  noExampleUsage: number
  /** 缺音标词条数 */
  noPhonetic: number
  /** 缺混淆项（且有释义）词条数 */
  confusableMissing: number
  /** 疑似非原型词条数 */
  lemmaCandidates: number
  /** 到期待复习数 */
  due: number
  /** 未学过的新词数 */
  newWords: number
  /** 仿写历史条数 */
  writingHistory: number
}

export interface ReadyRow {
  /** 分组：读 / 词 / 听 / 写 */
  group: string
  key: string
  label: string
  level: ReadyLevel
  detail: string
  hint?: string
}

export function buildReadiness(i: ReadyInput): ReadyRow[] {
  const rows: ReadyRow[] = []

  // ── 读 ──
  rows.push({
    group: '读',
    key: 'article',
    label: '文章',
    level: i.hasDoc ? 'ready' : 'blocked',
    detail: i.hasDoc ? `${i.sentences} 句` : '没有打开文章',
    hint: i.hasDoc ? undefined : '打开内置文章，或在「新建文章」里粘贴正文',
  })
  rows.push({
    group: '读',
    key: 'sentence',
    label: '翻译 / 语法 / 搭配',
    level: i.hasDoc ? 'ready' : 'blocked',
    detail: i.hasDoc ? `已译 ${i.translated} / ${i.sentences} 句` : '先打开文章',
    hint: i.hasDoc ? '选中句子 → 复制提示词 → 粘回「应用结果」' : undefined,
  })

  // ── 词 ──
  rows.push({
    group: '词',
    key: 'vocab',
    label: '生词本',
    level: i.vocab > 0 ? 'ready' : 'blocked',
    detail: i.vocab > 0 ? `${i.vocab} 个词` : '还是空的',
    hint:
      i.vocab > 0
        ? undefined
        : '划词标生词 / 选词进「待选」→ 查词或「直接入库」；也可以先「自动标词」',
  })
  rows.push({
    group: '词',
    key: 'batch',
    label: '待选',
    level: i.batch > 0 ? 'partial' : 'ready',
    detail: i.batch > 0 ? `${i.batch} 个待处理` : '无',
    hint: i.batch > 0 ? '点「复制查词提示词」，把结果粘回后「加入生词本」' : undefined,
  })
  rows.push({
    group: '词',
    key: 'unqueried',
    label: '查词',
    level: i.unqueried > 0 ? 'partial' : 'ready',
    detail: i.unqueried > 0 ? `${i.unqueried} 个未查` : '没有未查的词',
    hint: i.unqueried > 0 ? '点「补查音标 / 全部重查」生成提示词补齐释义/音标' : undefined,
  })
  rows.push({
    group: '词',
    key: 'meaning',
    label: '释义完整度',
    level: i.noMeaning > 0 ? 'partial' : 'ready',
    detail: i.noMeaning > 0 ? `${i.noMeaning} 个缺释义` : '都有释义',
    hint: i.noMeaning > 0 ? '缺释义会让「拼写 / 看词选义」出不了题' : undefined,
  })
  rows.push({
    group: '词',
    key: 'example',
    label: '例句 / 用法',
    level: i.noExampleUsage > 0 ? 'partial' : 'ready',
    detail: i.noExampleUsage > 0 ? `${i.noExampleUsage} 个缺例句或用法` : '够用',
    hint: i.noExampleUsage > 0 ? '缺例句/用法会让「例句填空 / 搭配填空」出不了题' : undefined,
  })
  rows.push({
    group: '词',
    key: 'confusable',
    label: '混淆项',
    level: i.confusableMissing > 0 ? 'partial' : 'ready',
    detail: i.confusableMissing > 0 ? `${i.confusableMissing} 个缺` : '已够用',
    hint: i.confusableMissing > 0 ? '点「生成混淆项」让选择题干扰项更准' : undefined,
  })
  rows.push({
    group: '词',
    key: 'lemma',
    label: '原形规范',
    level: i.lemmaCandidates > 0 ? 'partial' : 'ready',
    detail: i.lemmaCandidates > 0 ? `${i.lemmaCandidates} 个疑似非原形` : '规范',
    hint: i.lemmaCandidates > 0 ? '点「校正原形」用语境判断词形，或「去重整理」' : undefined,
  })
  rows.push({
    group: '词',
    key: 'review',
    label: '复习排期',
    level: i.vocab > 0 ? 'ready' : 'blocked',
    detail: i.vocab > 0 ? `待复习 ${i.due} · 新词 ${i.newWords}` : '先有生词',
    hint: i.vocab > 0 ? '背单词（新学习 / 复习）、快刷、考试都从这里取材' : undefined,
  })

  // ── 听 ──
  rows.push({
    group: '听',
    key: 'dictation',
    label: '逐句听写',
    level: i.hasDoc ? 'ready' : 'blocked',
    detail: i.hasDoc ? `${i.sentences} 句可听写` : '先打开文章',
    hint: i.hasDoc ? '点「听写」：播一句 → 写一句 → 逐词对比' : undefined,
  })
  rows.push({
    group: '听',
    key: 'listen',
    label: '听力理解题',
    level: !i.hasDoc ? 'blocked' : i.listenQuiz > 0 ? 'ready' : 'partial',
    detail: !i.hasDoc
      ? '先打开文章'
      : i.listenQuiz > 0
        ? `已生成 ${i.listenQuiz} 题`
        : '还没有题',
    hint: i.hasDoc && i.listenQuiz === 0 ? '点「理解题」复制出题提示词，粘回后即可作答' : undefined,
  })

  // ── 写 ──
  rows.push({
    group: '写',
    key: 'language',
    label: '语言点分析',
    level: !i.hasDoc ? 'blocked' : i.language > 0 ? 'ready' : 'partial',
    detail: !i.hasDoc ? '先打开文章' : i.language > 0 ? `已分析 ${i.language} / ${i.sentences} 句` : '还没分析',
    hint: i.hasDoc && i.language === 0 ? '点「语言点」复制提示词，粘回后写回句子' : undefined,
  })
  rows.push({
    group: '写',
    key: 'imitation',
    label: '仿写 / 批改',
    level: i.hasDoc ? 'ready' : 'blocked',
    detail: i.hasDoc ? `练习历史 ${i.writingHistory} 条` : '先打开文章',
    hint: i.hasDoc ? '点「仿写」：范句 → 任务 → 你写 → AI 严格批改' : undefined,
  })

  return rows
}
