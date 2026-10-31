export const GOLDEN_VIEWS = [
  'home',
  'plan',
  'drill',
  'recall',
  'summary',
  'bank',
  'exam',
  'history',
  'errors',
] as const
export type GoldenView = (typeof GOLDEN_VIEWS)[number]

/** 单句练习阶段；放在这里给 useGoldenDrill / useGoldenFillAssemble 共用，避免循环 import。 */
export type GoldenPhase = 'preview' | 'fill' | 'assemble' | 'summary' | 'imitation'

export interface GoldenSession {
  view: GoldenView
  index: number
  recallIndex: number
}

export function isGoldenView(value: unknown): value is GoldenView {
  return typeof value === 'string' && (GOLDEN_VIEWS as readonly string[]).includes(value)
}

/** localStorage 里的会话位置：坏数据一律当没存过，不把界面卡在空视图。 */
export function parseGoldenSession(raw: unknown): GoldenSession | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (!isGoldenView(o.view)) return null
  const index = Number(o.index)
  const recallIndex = Number(o.recallIndex)
  return {
    view: o.view,
    index: Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0,
    recallIndex: Number.isFinite(recallIndex) && recallIndex >= 0 ? Math.floor(recallIndex) : 0,
  }
}

export function goldenSessionKey(articleKey: string | null): string {
  return `reader:goldenSession:${articleKey ?? ''}`
}

export function readGoldenSession(articleKey: string | null): GoldenSession | null {
  try {
    const raw = localStorage.getItem(goldenSessionKey(articleKey))
    if (!raw) return null
    return parseGoldenSession(JSON.parse(raw))
  } catch {
    return null
  }
}

export function writeGoldenSession(articleKey: string | null, session: GoldenSession): void {
  try {
    localStorage.setItem(goldenSessionKey(articleKey), JSON.stringify(session))
  } catch {
    // 隐私模式忽略
  }
}
