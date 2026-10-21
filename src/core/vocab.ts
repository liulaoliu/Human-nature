/**
 * 词库逻辑：生词数据「怎么变」的规则层。
 *
 * 这个文件只做**对外出口**，实现按职责拆在 `core/vocab/`：
 *   - `word.ts`：词形归一化 / lemma / 词性与释义清洗
 *   - `merge.ts`：例句 / 词组 / 语法标记 / 卡片内容块 / 同 lemma 合并
 *   - `analysis.ts`：标词 / 粘回查词结果 / 混淆项 / 原形校正 / 辨析
 *   - `library.ts`：增删改 / 打印 / 优先重排 / 筛选分组排序
 *   - `review.ts`：SM-2 复习排期 / 背单词队列
 *   - `extra.ts`：忘记 / 模糊的加练与「重练忘记的」出场账本（每轮次数上限）
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
