import { VOICE_HANGOVER_MS } from '../core/recording'
import {
  type AudioPlayerPort,
  type CalibrationRepoPort,
  type Chunk,
  type Granularity,
  type RecorderPort,
  type ScriptEditRepoPort,
  type ScriptRepoPort,
  type Take,
  type TakeRepoPort,
} from '../core/ports'
import type { AlignedChunk, ResolvedAnchor } from '../core/alignText'

/**
 * 跟读会话的状态形状与初始值（纯数据，不依赖 React）。
 * 从 `state/session.ts` 抽出来：状态字段有三十来个，混在千行的 store 里
 * 想看清「一共有哪些状态」得翻半天。
 */
export interface SessionState {
  status: 'empty' | 'loading' | 'ready' | 'error'
  fileName: string
  duration: number
  chunks: Chunk[]
  current: number
  takes: Take[]
  granularity: Granularity
  rate: number
  recording: boolean
  /** 参考音是不是正在播（空格键的图标签要跟着变） */
  playing: boolean
  /** 连续跟读开关。关着的时候空格就是播放/暂停，一切照旧 */
  autoCycle: boolean
  /** 这一轮连续跟读走到哪一步了，UI 靠它显示状态 */
  cycleStep: 'idle' | 'ref' | 'rec' | 'playback'
  /** 自动录音会给多久，UI 上告诉用户「最多 N 秒」 */
  autoRecordMs: number
  /** 说完之后静多少毫秒算「读完了」。可调：读得慢/常有停顿的人需要更长 */
  hangoverMs: number
  /** 暂停时停在哪一块、停在哪一秒，用来「接着播」 */
  pausedChunk: number | null
  level: number
  abPlaying: boolean
  error: string | null
  /** 这次录音的输入峰值太低（麦克风增益没调起来），UI 提示去系统设置调大 */
  lowMic: boolean
  /** 原文。优先用原文库自动带上的，没有才靠用户粘（T 键） */
  script: string
  /** script 是自动带的还是手动粘的，UI 上给个提示 */
  scriptSource: 'auto' | 'manual' | 'none'
  /** 原文库取到了没有。false = articles.json 没拿到，和「库里没这篇」要分开告诉用户 */
  scriptLibrary: boolean
  /** 文本相对音频的整体平移，单位是词。见 alignTextToChunks 的说明 */
  offsetWords: number
  /** 正文从哪一块开始。音频前面常有文本里没有的引子，标一下就不差这一截了 */
  textStartChunk: number
  /** 鼠标选字手动锚定了多少块。>0 时 offsetWords/textStartChunk 让位给锚点 */
  manualAnchors: number
  /** 手动锚点解析到当前文本后的词范围（UI 用来标开头结尾） */
  manualRanges: ResolvedAnchor[]
  /** 手动撕开/合并了几处（>0 时 UI 显示「已手动切分」和重置入口） */
  chunkEditCount: number
  /** 手动撕开的时间点（秒），UI 在左侧列表标出这些新边界 */
  splitPoints: number[]
  /** script 按块摊开的结果，长度恒等于 chunks.length */
  aligned: AlignedChunk[]
}

export interface SessionDeps {
  player: AudioPlayerPort
  recorder: RecorderPort
  repo: TakeRepoPort
  /** 原文库，可选。不给就等于没有自动带文本，只能手动粘 */
  scripts?: ScriptRepoPort
  /** 手动改过的正文的持久化，可选。不给就只记在内存里，刷新回原文库 */
  scriptEdits?: ScriptEditRepoPort
  /** 手动校准（文字偏移 / 正文起点）的持久化，可选。不给就只记在内存里 */
  calibration?: CalibrationRepoPort
  /** A/B 两段之间的停顿 */
  abGapMs?: number
  /** 连续跟读里「标准音 → 录音」之间的停顿，留出切换状态的时间 */
  cycleGapMs?: number
  /** 说话声判定阈值（0..1 峰值）。低于它算没在说话 */
  voiceLevel?: number
  /** 说完之后静多久算「读完了」。太短会被句中的停顿切掉 */
  voiceHangoverMs?: number
}

export const INITIAL: SessionState = {
  status: 'empty',
  fileName: '',
  duration: 0,
  chunks: [],
  current: 0,
  takes: [],
  granularity: 'normal',
  rate: 1,
  recording: false,
  playing: false,
  autoCycle: false,
  cycleStep: 'idle',
  autoRecordMs: 0,
  hangoverMs: VOICE_HANGOVER_MS,
  pausedChunk: null,
  level: 0,
  abPlaying: false,
  error: null,
  lowMic: false,
  script: '',
  scriptSource: 'none',
  scriptLibrary: true,
  offsetWords: 0,
  textStartChunk: 0,
  manualAnchors: 0,
  manualRanges: [],
  chunkEditCount: 0,
  splitPoints: [],
  aligned: [],
}
