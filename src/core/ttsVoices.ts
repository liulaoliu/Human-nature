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
