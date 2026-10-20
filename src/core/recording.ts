/**
 * 录音相关的参数与判定规则。
 *
 * 之前这些数字和函数散在 `state/session.ts` 里，跟着一个千行类一起漂：
 * 「说完静多久算读完」「最多录多久」「电平多高算在说话」这三条直接决定
 * **会不会把人读到一半掐掉**，值得单独写测试。
 *
 * 纯数据 + 纯函数：不碰计时器、不碰麦克风。
 */

/**
 * 说完之后静多久算「读完了」。
 * 默认 2.5 秒：正常句子之间的停顿不到 1 秒，但跟读时想一下再开口、
 * 或者读得慢/句中有停顿的人，都可能超过 1.6 秒；这个值可以在界面上调。
 * 判断错了最坏情况只是等满兜底时长，不会丢录音。
 */
export const VOICE_HANGOVER_MS = 2500

/**
 * 连续跟读里标准音结束到开始录音之间留的空档。
 * 播音员速度和你自己的速度不一样，这半秒是给你换气、把嘴张开用的；
 * 不留的话录音开头永远是你的吸气声。
 */
export const AUTO_CYCLE_GAP_MS = 600

/**
 * 说话判定的**绝对下限**（真·安静房间的底噪也不该触发它）。
 * 实际阈值 = max(下限, 噪声底 + 余量)，见 voiceThreshold。
 */
export const VOICE_LEVEL = 0.006

/** 比噪声底高多少算在说话。用「加」不用「乘」，避免连续朗读时阈值被自己抬高 */
export const VOICE_MARGIN = 0.008

/** 每次开录时给噪声底的初值；随后只取「见过的最低电平」（单调不增） */
export const NOISE_FLOOR_INIT = 0.005

/**
 * 电平送进 state 的最小间隔（毫秒）。
 * 电平表每帧回调一次（~60/s），不节流就是 60fps 整页重渲染；
 * 25fps 看电平表照样跟手。
 */
export const LEVEL_PUSH_MS = 40

/**
 * 这一块最多录多久 —— 只是**兜底上限**。
 * 正常情况下不用等满：说完停下几秒（默认 2.5 秒，可调）就自动结束进对比了。
 * 上限给得宽是因为学习者比播音员慢，宁可多留也不能把人读一半掐掉；
 * 也不给无限长，静音检测失灵时（麦没声、底噪太高）总得有个头。
 */
export function recordCapMs(chunkSec: number): number {
  return Math.min(90000, Math.max(4000, Math.round(chunkSec * 2000 + 3000)))
}

/**
 * 「在说话」的电平阈值：取绝对下限和「噪声底 + 余量」里大的那个。
 *
 * 不同麦克风增益差很多，固定阈值会让小音量设备永远判定不出「说完了」，
 * 所以跟着噪声底走；用加法不用乘法，连续朗读时噪声底被抬高也不会把阈值顶上去。
 */
export function voiceThreshold(noiseFloor: number, minLevel = VOICE_LEVEL): number {
  return Math.max(minLevel, noiseFloor + VOICE_MARGIN)
}
