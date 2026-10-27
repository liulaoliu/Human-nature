import type { GoldenRecordLike } from './types'

export const ROLE_LABEL: Record<'intro' | 'body' | 'conclusion', string> = {
  intro: '开头段',
  body: '主体段',
  conclusion: '结尾段',
}

export function isMastered(rec: GoldenRecordLike | null | undefined): boolean {
  return !!rec?.mastered
}
