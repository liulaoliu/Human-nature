/**
 * 「同一个键：读 → 停 → 从头再读」的判定。
 *
 * 只认一件事：现在是不是正在读**这段文字**。
 * 读别的句子 / 整篇连播时按同一个键，都算「改读这一句」，不当作停止。
 */

/** 朗读状态（与 `useTtsMedia` 的 `ttsState` 同口径）。 */
export type SpeakState = 'idle' | 'loading' | 'playing'

export interface SpeakToggleInput {
  /** 想朗读的文本（选中的句子）。 */
  text: string | null | undefined
  /** 正在朗读的文本（`nowPlaying.text`）。 */
  playingText: string | null | undefined
  /** 当前朗读状态：loading 也算「正在读」，再按一次应当停下。 */
  state: SpeakState
  /** 是否在逐句连播整篇；连播时按这个键应当改读选中句，而不是停下空着。 */
  readingAll?: boolean
}

export type SpeakToggleAction = { type: 'stop' } | { type: 'speak'; text: string }

/**
 * 下一动作：同一段正在读（或正在合成）→ 停；其余 → 从头读。
 * 没有选中文本 → null（不碰当前播放）。
 */
export function nextSpeakToggle(input: SpeakToggleInput): SpeakToggleAction | null {
  const text = (input.text ?? '').trim()
  if (!text) return null
  const playing = (input.playingText ?? '').trim()
  if (!input.readingAll && input.state !== 'idle' && playing === text) return { type: 'stop' }
  return { type: 'speak', text }
}
