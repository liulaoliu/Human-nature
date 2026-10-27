/**
 * 学习记录的 section ⇄ 表名映射。
 *
 * 单独一个文件是为了解开读写两侧的循环：`sqliteLearning.js`（读 + 快照）
 * 和 `sqliteLearningWrite.js`（写）都要认这份映射，谁 import 谁都会成环。
 */

// 显式 Record<string, string[]>：读写两侧都用 string 索引这张表
// （clearLearningSections 遍历外部传入的 sections，键是运行时字符串）。
export const LEARNING_SECTION_TABLES: Record<string, string[]> = {
  practice: ['practice_records'],
  mistakes: ['mistake_records'],
  readDone: ['reading_progress'],
  writingHistory: ['writing_records'],
  backTranslations: ['back_translation_records'],
  retells: ['retell_records'],
  activity: ['activity_days'],
  studyDays: ['study_days'],
  sessions: ['pick_sessions'],
  studiedDays: ['study_word_days'],
  skimmed: ['skimmed_articles'],
  kindStats: ['kind_stats'],
  answerEvents: ['answer_events'],
  goldenDrills: ['golden_drill_records'],
}

export const LEARNING_SECTIONS = Object.keys(LEARNING_SECTION_TABLES)
export const LEARNING_TABLES = [...new Set(Object.values(LEARNING_SECTION_TABLES).flat())]
