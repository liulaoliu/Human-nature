/**
 * 精读模块：一键提示词生成 + 粘回解析（对外门面）。
 *
 * 不默认直连 API（浏览器里放密钥会泄露）。流程是：
 *   选中文字 → buildPrompt() 生成提示词 → 复制到网页版 DeepSeek
 *   → 把返回文本贴回来 → parseAnalysis() / applyToSentence() 落到数据上。
 *
 * 解析结果用统一的 AnalysisResult，将来接 API 也不用改模型。
 *
 * 实现分三层（本文件只做 re-export，调用方与测试的 import 不用改）：
 *   - `analyzerShared.ts`：任务类型、表结构类型、共用字符串工具
 *   - `analyzerPrompt.ts`：所有 `build*` 提示词构建
 *   - `analyzerParse.ts`：所有 `parse*` 结果解析
 */

export * from './analyzerShared'
export * from './analyzerPrompt'
export * from './analyzerParse'
