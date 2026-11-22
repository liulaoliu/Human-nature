/**
 * 连续跟读的状态机：标准音 → 录音 → 回放 → 下一句。
 *
 * 只回答「下一步该干什么」，不碰 React、不碰音频：真正播放/录音由 hook 执行。
 * 这样这段顺序（以及出错/停止时怎么收尾）能单测，不会散在回调里。
 */

export type RepeatStep = 'idle' | 'ref' | 'rec' | 'take'

export type RepeatEvent = 'start' | 'refEnd' | 'recEnd' | 'takeEnd' | 'stop' | 'fail'

/** 执行层要做的动作。`next` = 先切下一句，再按 `playRef` 播。 */
export type RepeatAction = 'playRef' | 'startRec' | 'playTake' | 'next' | 'stop' | 'none'

export interface RepeatState {
  step: RepeatStep
}

export const REPEAT_IDLE: RepeatState = { step: 'idle' }

/**
 * 推进一步。事件和当前步骤对不上时原样返回（例如录音被用户取消后又收到 refEnd），
 * 不让乱序的回调把状态机带偏。
 */
export function repeatNext(
  state: RepeatState,
  event: RepeatEvent,
  opts: { hasNext: boolean },
): { state: RepeatState; action: RepeatAction } {
  if (event === 'stop' || event === 'fail') return { state: REPEAT_IDLE, action: 'stop' }
  if (event === 'start') return { state: { step: 'ref' }, action: 'playRef' }
  if (state.step === 'ref' && event === 'refEnd') return { state: { step: 'rec' }, action: 'startRec' }
  if (state.step === 'rec' && event === 'recEnd') return { state: { step: 'take' }, action: 'playTake' }
  if (state.step === 'take' && event === 'takeEnd') {
    return opts.hasNext
      ? { state: { step: 'ref' }, action: 'next' }
      : { state: REPEAT_IDLE, action: 'stop' }
  }
  return { state, action: 'none' }
}

/** 面板上的一行状态字。 */
export function repeatStepLabel(step: RepeatStep): string {
  if (step === 'ref') return '听标准音…'
  if (step === 'rec') return '录音中，读完停一下'
  if (step === 'take') return '回放我的录音…'
  return ''
}

/** 复读语速档位（TTS 支持任意 rate，这里只给常用的几档）。 */
export const REPEAT_RATES = [0.75, 0.9, 1, 1.1, 1.25] as const

/** 单句循环遍数；0 = 不限。 */
export const REPEAT_LOOPS = [1, 3, 5, 0] as const

export function loopLabel(n: number): string {
  return n === 0 ? '不限' : `${n} 遍`
}
