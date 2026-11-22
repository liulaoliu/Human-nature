import type { Sentence } from '../types/document'

/**
 * D 老师复读的一条录音。
 *
 * 不复用跟读页的 `Take`：那边一条录音属于「某个音频文件的第几块」，
 * 这边属于「某篇文章的某个句子」，而且要带文本戳——`Sentence.id` 是重切句时
 * 顺序生成的，改正文后会漂移，只有文本一致才能确认这条录音还是这句的。
 */
export interface RepeatTake {
  /** `articleKey + sentenceId`，一篇一句只有一条（只留最新）。 */
  id: string
  /** 文章标识（不是正文签名：改一句不该让整篇录音全作废）。 */
  articleKey: string
  sentenceId: string
  /** 录这条时的句子原文，用来识别 id 漂移。 */
  sentenceText: string
  blob: Blob
  mimeType: string
  durationSec: number
  /** 真正在说话的区间（秒），回放时掐掉首尾静音。 */
  speechFrom?: number
  speechTo?: number
  createdAt: number
}

const SEP = '\u0000'

export function repeatTakeId(articleKey: string, sentenceId: string): string {
  return `${articleKey}${SEP}${sentenceId}`
}

/** 这条录音还能不能算当前句的：id 对得上还不够，文本也要一致。 */
export function isRepeatTakeFor(take: RepeatTake, sentence: Sentence): boolean {
  return take.sentenceId === sentence.id && take.sentenceText === sentence.text
}

/** 单条下载的文件名：文章标题 + 句序。 */
export function repeatTakeName(title: string, index: number): string {
  const base =
    title
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '_')
      .slice(0, 40) || '复读'
  return `${base}-${String(index + 1).padStart(2, '0')}.webm`
}
