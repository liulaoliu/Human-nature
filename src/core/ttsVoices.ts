/**
 * Edge TTS 英语音色目录（按口音/地区分组）。
 *
 * 口音粒度：Edge TTS 只提供 **locale 级** 口音（美式 / 英式 / 澳式 / 印度 …），
 * 没有「伦敦东区（Cockney）」「加州（West Coast）」这种次区域口音。
 * 想更细只能靠声音克隆（XTTS-v2 / ElevenLabs）。
 *
 * id 直接透传给服务端 `/api/tts?voice=…`（见 tools/tts-core.mjs）。
 * 清单来自微软 voices 接口，可按需增删。
 */

export interface TtsVoice {
  id: string
  name: string
  gender: '女' | '男'
}

export interface TtsAccent {
  /** 分组标题（口音 / 地区） */
  label: string
  voices: TtsVoice[]
}

export const DEFAULT_TTS_VOICE = 'en-US-AriaNeural'

export const TTS_ACCENTS: TtsAccent[] = [
  {
    label: '美式 · 通用美音',
    voices: [
      { id: 'en-US-AriaNeural', name: 'Aria', gender: '女' },
      { id: 'en-US-JennyNeural', name: 'Jenny', gender: '女' },
      { id: 'en-US-MichelleNeural', name: 'Michelle', gender: '女' },
      { id: 'en-US-AvaNeural', name: 'Ava', gender: '女' },
      { id: 'en-US-EmmaNeural', name: 'Emma', gender: '女' },
      { id: 'en-US-AnaNeural', name: 'Ana', gender: '女' },
      { id: 'en-US-AndrewNeural', name: 'Andrew', gender: '男' },
      { id: 'en-US-BrianNeural', name: 'Brian', gender: '男' },
      { id: 'en-US-ChristopherNeural', name: 'Christopher', gender: '男' },
      { id: 'en-US-EricNeural', name: 'Eric', gender: '男' },
      { id: 'en-US-GuyNeural', name: 'Guy', gender: '男' },
      { id: 'en-US-RogerNeural', name: 'Roger', gender: '男' },
      { id: 'en-US-SteffanNeural', name: 'Steffan', gender: '男' },
    ],
  },
  {
    label: '英式 · 标准英音（伦敦一带）',
    voices: [
      { id: 'en-GB-SoniaNeural', name: 'Sonia', gender: '女' },
      { id: 'en-GB-LibbyNeural', name: 'Libby', gender: '女' },
      { id: 'en-GB-MaisieNeural', name: 'Maisie', gender: '女' },
      { id: 'en-GB-RyanNeural', name: 'Ryan', gender: '男' },
      { id: 'en-GB-ThomasNeural', name: 'Thomas', gender: '男' },
    ],
  },
  {
    label: '澳大利亚',
    voices: [
      { id: 'en-AU-NatashaNeural', name: 'Natasha', gender: '女' },
      { id: 'en-AU-WilliamMultilingualNeural', name: 'William', gender: '男' },
    ],
  },
  {
    label: '加拿大',
    voices: [
      { id: 'en-CA-ClaraNeural', name: 'Clara', gender: '女' },
      { id: 'en-CA-LiamNeural', name: 'Liam', gender: '男' },
    ],
  },
  {
    label: '爱尔兰',
    voices: [
      { id: 'en-IE-EmilyNeural', name: 'Emily', gender: '女' },
      { id: 'en-IE-ConnorNeural', name: 'Connor', gender: '男' },
    ],
  },
  {
    label: '印度',
    voices: [
      { id: 'en-IN-NeerjaNeural', name: 'Neerja', gender: '女' },
      { id: 'en-IN-PrabhatNeural', name: 'Prabhat', gender: '男' },
    ],
  },
  {
    label: '新西兰',
    voices: [
      { id: 'en-NZ-MollyNeural', name: 'Molly', gender: '女' },
      { id: 'en-NZ-MitchellNeural', name: 'Mitchell', gender: '男' },
    ],
  },
  {
    label: '南非',
    voices: [
      { id: 'en-ZA-LeahNeural', name: 'Leah', gender: '女' },
      { id: 'en-ZA-LukeNeural', name: 'Luke', gender: '男' },
    ],
  },
  {
    label: '新加坡 / 香港 / 菲律宾',
    voices: [
      { id: 'en-SG-LunaNeural', name: 'Luna（新加坡）', gender: '女' },
      { id: 'en-SG-WayneNeural', name: 'Wayne（新加坡）', gender: '男' },
      { id: 'en-HK-YanNeural', name: 'Yan（香港）', gender: '女' },
      { id: 'en-HK-SamNeural', name: 'Sam（香港）', gender: '男' },
      { id: 'en-PH-RosaNeural', name: 'Rosa（菲律宾）', gender: '女' },
      { id: 'en-PH-JamesNeural', name: 'James（菲律宾）', gender: '男' },
    ],
  },
]

/** 扁平化的合法音色 id 集合。 */
export const TTS_VOICE_IDS: Set<string> = new Set(TTS_ACCENTS.flatMap((a) => a.voices.map((v) => v.id)))

/** 服务端探测到的离线引擎音色（SAPI / Linux espeak-ng）。 */
export interface TtsEngineVoice {
  /** 形如 sapi:Microsoft Zira Desktop / local:en-us */
  id: string
  name: string
  gender?: string
  lang?: string
}

/** `/api/tts/engines` 里的离线引擎信息。 */
export interface TtsEngineInfo {
  sapi?: { available: boolean; voices: TtsEngineVoice[] }
  local?: { available: boolean; voices: TtsEngineVoice[] }
}

/** 离线引擎前缀：Windows SAPI / Linux 本地语音。 */
const OFFLINE_VOICE_PREFIXES = ['sapi:', 'local:'] as const

/** 是不是离线引擎音色：没有逐词时间戳，也不受 Edge 临时降级影响。 */
export function isOfflineTtsVoice(voice: string): boolean {
  return OFFLINE_VOICE_PREFIXES.some((p) => voice.startsWith(p))
}

function cleanEngineName(name: string): string {
  return name.replace(/^Microsoft\s+/i, '').replace(/\s+Desktop$/i, '')
}

/** 把一路离线引擎的音色并成下拉分组；没有可用音色返回 null。 */
export function engineVoiceAccent(
  label: string,
  engine: { available?: boolean; voices?: TtsEngineVoice[] } | null | undefined,
): TtsAccent | null {
  if (!engine?.available || !engine.voices?.length) return null
  return {
    label,
    voices: engine.voices.map((v) => ({
      id: v.id,
      name: v.lang ? `${cleanEngineName(v.name)}（${v.lang}）` : cleanEngineName(v.name),
      gender: /^(male|m|男)$/i.test(v.gender ?? '') ? '男' : '女',
    })),
  }
}

/**
 * 朗读音色下拉的完整分组：Edge 在线音色在前，本机可用的离线引擎追加在后。
 * 探测失败（null）时只显示 Edge，行为与老版本一致。
 */
export function buildTtsAccents(engines: TtsEngineInfo | null | undefined): TtsAccent[] {
  const out = [...TTS_ACCENTS]
  const local = engineVoiceAccent('离线 · 本地语音（espeak-ng，不联网）', engines?.local)
  if (local) out.push(local)
  const sapi = engineVoiceAccent('离线 · 系统语音（不联网）', engines?.sapi)
  if (sapi) out.push(sapi)
  return out
}
