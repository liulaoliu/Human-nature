import { parseListeningQuiz } from '../../core/listening'
import type { ApplyContext, ApplyOutcome } from './types'

/** 听力理解题：解析严格 JSON，存进状态并缓存到本篇。 */
export function applyListening(ctx: ApplyContext): ApplyOutcome {
  const quiz = parseListeningQuiz(ctx.text)
  if (!quiz.questions.length)
    return { report: ['没解析出题目（需要严格 JSON：{"questions":[…] }，含 type/stem/answer）'], missing: null, ok: false }
  ctx.setListenQuiz(quiz)
  try {
    localStorage.setItem('reader:listening:' + ctx.listeningKey, JSON.stringify(quiz))
  } catch {
    // 忽略
  }
  return { report: [`已生成 ${quiz.questions.length} 道题`, '点工具栏「理解题」开始作答'], missing: null, ok: true }
}
