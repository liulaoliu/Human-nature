/**
 * 词库逻辑：生词数据「怎么变」的规则层。
 *
 * 这个文件只做**对外出口**，实现按职责拆在 `core/vocab/`：
 *   - `word.ts`：词形归一化 / lemma / 词性与释义清洗
 *   - `merge.ts`：例句 / 词组 / 语法标记 / 卡片内容块 / 同 lemma 合并
 *   - `analysis.ts`：标词 / 粘回查词结果 / 混淆项 / 原形校正 / 辨析
 *   - `library.ts`：增删改 / 打印 / 优先重排 / 筛选分组排序
 *   - `review.ts`：SM-2 复习排期 / 重学阶梯 / 背单词队列
 *   - `extra.ts`：忘记 / 模糊的加练与「重练忘记的」出场账本（每轮次数上限）
 *   - `spelling.ts`：拼写判定（错一次即「不认识」并进入重学）
 *   - `meaningOptions.ts`：选中文释义的四个选项与稳定顺序（视图与会话共用）
 *   - `learnStep.ts`：学习模式「看答案 / 选对 / 选错」的判定与「选对次数」账本
 *   - `reviewStep.ts`：复习模式三键（认识 / 模糊 / 记错了）的写库与摊卡计划
 *   - `drill.ts`：超时「强制锤炼」该不该出现（评分门禁，判完的卡不抢）
 *   - `sense.ts`：义项一致性（词性 / 释义 / 英英必须说同一个义项；词典词性只是占位）
 *
 * 外部统一从这里 import，避免各自记子模块路径；纯函数，不碰界面、不碰 IndexedDB。
 * 存储层（IndexedDB/SQLite）在 adapters/，界面在 reader/ 与 ui/。
 */

export * from './vocab/word'
export * from './vocab/merge'
export * from './vocab/analysis'
export * from './vocab/library'
export * from './vocab/review'
export * from './vocab/extra'
export * from './vocab/spelling'
export * from './vocab/meaningOptions'
export * from './vocab/learnStep'
export * from './vocab/reviewStep'
export * from './vocab/drill'
export * from './vocab/sense'
