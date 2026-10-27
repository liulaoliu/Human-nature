/**
 * AI 工作包：把「复制提示词 → 贴到网页版 AI → 把结果粘回来」这一串手工活，
 * 打成一个文件整包交给 AI（或本机 agent），再把结果文件导回，一次应用全部。
 *
 * 这里只放**不依赖 DOM / React 的纯逻辑**：由当前数据推导待办、数待办、拼任务名。
 * 具体的解析与应用（apply*）仍在 ReaderApp 里组装。
 *
 * 分层（本文件是门面，调用方 import 不用改）：
 *   - `aiJobTypes.ts`：任务清单、job / result / pack 的类型
 *   - `aiPackIO.ts`：包的序列化 / 宽容解析 / 稳定 id
 *   - `aiTodos.ts`：待办筛选与分块（build 与 count 共用，避免两处条件漂移）
 *   - `aiWebPack.ts`：网页版提示词与 `@@@ANSWER` 回读
 */
import {
  buildAutoVocabPrompt,
  buildBatchLookupPrompt,
  buildConfusablePrompt,
  buildExamplePrompt,
  buildGrammarMarkPrompt,
  buildLemmaPrompt,
  buildPhrasePrompt,
  buildPosPrompt,
  buildTranslateAllPrompt,
  type VocabLevel,
} from './analyzer'
import {
  confusableChunks,
  contextChunks,
  exampleChunks,
  lookupChunks,
  markChunks,
  phraseChunks,
  pickLemmas,
  pickPos,
  pickTodoBase,
  sentenceChunks,
} from './aiTodos'
import { makeJobId } from './aiPackIO'
import { AI_TASK_LABEL } from './aiJobTypes'
import { buildGoldenPrompt } from './goldenAi'
import { buildLanguagePrompt, hasSentenceLanguage } from './language'
import { buildListeningQuizPrompt } from './listening'
import type { AiJob, AiJobTask } from './aiJobTypes'
import type { Sentence, VocabItem } from '../types/document'

export * from './aiJobTypes'
export * from './aiPackIO'
export * from './aiTodos'
export * from './aiWebPack'

/** 推导 AI 待办所需的当前数据（全部只读，便于单测）。 */
export interface AiJobsInput {
  /** 待选清单（选词模式攒的）。 */
  batch: { word: string; sentence?: string }[]
  /** 整个词库。 */
  items: VocabItem[]
  /** 本篇的词（来源属于本文）。 */
  articleWords: VocabItem[]
  /** 打包范围：只处理本篇，还是整个词库。 */
  scope: 'article' | 'all'
  /** 每次生成混淆项的批量大小（0=全部）。 */
  confusableBatchSize: number
  /** 当前文章的稳定标识（用于自动标词的「已完成」标记 / 稳定 id）。 */
  articleId: string
  /** 正文签名键（`core/docSignature.articleKey`）；金句结果应用前校验。 */
  articleKey?: string
  /** 本篇是否已经应用过「自动标词」（应用过就不再进默认待办）。 */
  autoVocabDone?: boolean
  /** 本篇是否已经有金句课（有就不再进默认待办）。 */
  hasGolden?: boolean
  /** 当前文章的句子。 */
  sentences: Sentence[]
  /** 自动标词的词汇标准。 */
  vocabLevel: VocabLevel
  /** 是否已有听力理解题。 */
  hasListenQuiz: boolean
  /** 听力题数量。 */
  listenCount: number
}

/**
 * 由当前数据推导出所有「待办」：每条 = 一条完整提示词 + 应用时需要的上下文。
 * 覆盖：待选查词 / 补音标释义 / 混淆项 / 原形 / -ing-ed / 翻译 / 语言点 / 听力。
 * 仿写与批改是交互式的（依赖用户当下写的内容），不打包。
 */
export function buildAiJobs(input: AiJobsInput): AiJob[] {
  const jobs: AiJob[] = []
  const push = (
    task: AiJobTask,
    label: string,
    prompt: string,
    askedWords: string[] = [],
    askedIds: string[] = [],
    idKey?: string,
  ) => {
    // 稳定 id：默认用「问过的词/句」当内容指纹，同内容重建后 id 不变；
    // 再按文章隔离——否则像「自动标词」这种内容指纹为空的任务，id 会在所有文章间相同，
    // 一篇应用过就会把别的文章的同一任务也判成「已完成」（doneSet 误杀）。
    const key = `${input.articleId}|${idKey ?? `${askedWords.join('\n')}|${askedIds.join('\n')}`}`
    jobs.push({
      id: makeJobId(task, key),
      task,
      label,
      askedWords,
      askedIds,
      prompt,
      ...(input.articleKey ? { articleKey: input.articleKey } : {}),
    })
  }

  const base = pickTodoBase(input)

  // 待选清单 → 批量查词
  if (input.batch.length) {
    push(
      'lookup',
      `批量查词（待选 ${input.batch.length}）`,
      buildBatchLookupPrompt(input.batch.map((b) => ({ word: b.word, context: b.sentence }))),
      input.batch.map((b) => b.word),
    )
  }
  // 自动标词：让 AI 按词汇标准从全文挑词 → 结果进「待选」；本篇应用过一次就不再出现
  if (input.sentences.length && !input.autoVocabDone) {
    push(
      'auto_vocab',
      `自动标词（${input.vocabLevel}）`,
      buildAutoVocabPrompt(
        input.sentences.map((s) => s.text).join(' '),
        input.vocabLevel,
      ),
    )
  }
  // 生词本缺音标/释义 → 批量查词
  for (const part of lookupChunks(base)) {
    push(
      'lookup',
      `补齐音标/释义（${part.length}）`,
      buildBatchLookupPrompt(part.map((it) => ({ word: it.word, context: it.source?.sentenceText }))),
      part.map((it) => it.word),
    )
  }
  // 缺混淆项 → 生成混淆项（按设置分批）
  for (const part of confusableChunks(base, input.confusableBatchSize)) {
    push(
      'confusable',
      `生成混淆项（${part.length}）`,
      buildConfusablePrompt(part.map((it) => ({ word: it.word, meaning: it.meaning }))),
      part.map((it) => it.word),
    )
  }
  // 例句（还没「AI 例句」就生成；离线例句不算数，AI 仍会给一份带中文的）
  // 分批：以前只取前 30 个，剩下的每点一次才推 30 个 —— 上百个缺口就是「点十次还在补」。
  for (const part of exampleChunks(base)) {
    push(
      'example',
      `例句（${part.length}）`,
      buildExamplePrompt(part.map((it) => ({ word: it.word, meaning: it.meaning ?? undefined }))),
      part.map((it) => it.word),
    )
  }
  // 缺词组 → 生成「词组 / 习语」（有释义、但还没标注过；空数组也算标注过）
  for (const part of phraseChunks(base)) {
    push(
      'phrase',
      `词组/习语（${part.length}）`,
      buildPhrasePrompt(part.map((it) => ({ word: it.word, meaning: it.meaning }))),
      part.map((it) => it.word),
    )
  }
  // 本篇里刚选中的词、但「本篇语境」还没释义 → 按**本篇上下文**重查一次
  for (const part of contextChunks(base, input.articleId)) {
    push(
      'lookup',
      `按本篇语境重查（${part.length}）`,
      buildBatchLookupPrompt(
        part.map((it) => ({
          word: it.word,
          context:
            (it.contexts ?? []).find((c) => c.fileName === input.articleId && !c.meaning)?.sentenceText ||
            it.source?.sentenceText,
        })),
      ),
      part.map((it) => it.word),
    )
  }
  // 疑似非原型 → 校正原形
  const lemmaCandidates = pickLemmas(base)
  if (lemmaCandidates.length) {
    push(
      'lemma',
      `校正原形（${lemmaCandidates.length}）`,
      buildLemmaPrompt(lemmaCandidates.map((it) => ({ word: it.word, context: it.source?.sentenceText }))),
      lemmaCandidates.map((it) => it.word),
    )
  }
  // -ing/-ed → 语法辨析
  const posCandidates = pickPos(base)
  if (posCandidates.length) {
    push(
      'pos',
      `-ing/-ed 辨析（${posCandidates.length}）`,
      buildPosPrompt(posCandidates.map((it) => ({ word: it.word, context: it.source?.sentenceText }))),
      posCandidates.map((it) => it.word),
    )
  }
  // 名词/动词/形容词缺语法标记（可数/不可数、及物/不及物…）→ 标注
  for (const part of markChunks(base)) {
    push(
      'grammar_mark',
      `语法标记（${part.length}）`,
      buildGrammarMarkPrompt(part.map((it) => ({ word: it.word, meaning: it.meaning }))),
      part.map((it) => it.word),
    )
  }
  // 缺译文 → 全文翻译（按句分块：一条塞几十句最容易在网页端被截断）
  let tPos = 0
  for (const part of sentenceChunks(input.sentences.filter((s) => !s.translation))) {
    const from = tPos + 1
    tPos += part.length
    push(
      'translate',
      `翻译（第 ${from}-${tPos} 句）`,
      buildTranslateAllPrompt(part.map((s) => ({ id: s.id, text: s.text }))),
      [],
      part.map((s) => s.id),
    )
  }
  // 缺语言点 → 逐句语言点（同样按句分块）
  let lPos = 0
  for (const part of sentenceChunks(input.sentences.filter((s) => !hasSentenceLanguage(s)))) {
    const from = lPos + 1
    lPos += part.length
    push(
      'language',
      `语言点（第 ${from}-${lPos} 句）`,
      buildLanguagePrompt(part.map((s) => ({ id: s.id, text: s.text }))),
      [],
      part.map((s) => s.id),
    )
  }
  // 还没有金句课 → D老师小课堂。只给当前文章做：这是长 prompt，不跟「全库」范围走。
  if (input.sentences.length && input.hasGolden === false) {
    push(
      'golden',
      `D老师小课堂（${Math.min(10, input.sentences.length)} 句）`,
      buildGoldenPrompt({
        sentences: input.sentences.map((s) => ({
          id: s.id,
          text: s.text,
          ...(s.translation ? { translation: s.translation } : {}),
          paraId: s.paraId,
        })),
        maxSentences: 10,
      }),
      [],
      input.sentences.map((s) => s.id),
    )
  }
  // 没有听力题 → 生成听力理解题
  if (input.sentences.length && !input.hasListenQuiz) {
    push(
      'listening',
      `听力理解题（${input.listenCount} 题）`,
      buildListeningQuizPrompt(input.sentences.map((s) => s.text).join(' '), { count: input.listenCount }),
    )
  }
  return jobs
}

/** 待办任务数（只数，不生成提示词，便宜）。筛选条件与 `buildAiJobs` 共用 `aiTodos`。 */
export function countAiJobs(input: AiJobsInput): number {
  const base = pickTodoBase(input)
  let n = 0
  if (input.batch.length) n++
  n += lookupChunks(base).length
  n += confusableChunks(base, input.confusableBatchSize).length
  n += contextChunks(base, input.articleId).length
  n += exampleChunks(base).length
  n += phraseChunks(base).length
  if (!input.autoVocabDone && input.sentences.length) n++
  if (pickLemmas(base).length) n++
  if (pickPos(base).length) n++
  n += markChunks(base).length
  n += sentenceChunks(input.sentences.filter((s) => !s.translation)).length
  n += sentenceChunks(input.sentences.filter((s) => !hasSentenceLanguage(s))).length
  if (input.sentences.length && input.hasGolden === false) n++
  if (input.sentences.length && !input.hasListenQuiz) n++
  return n
}

/**
 * 「第 N 轮 · 查词/补齐」里那一串任务名：本批任务类型去重后按首次出现顺序拼起来。
 * 只用于提示文案，不影响出题与导入。
 */
export function jobPhaseLabel(jobs: AiJob[]): string {
  const seen: AiJobTask[] = []
  for (const j of jobs) if (!seen.includes(j.task)) seen.push(j.task)
  return seen.map((t) => AI_TASK_LABEL[t] ?? t).join('、')
}
