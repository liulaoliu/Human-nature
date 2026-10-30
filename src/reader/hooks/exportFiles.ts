import { exportLibraryJSON, toAnkiCSV, toWordListTXT, toWordsCSV, toWrongWordsCSV } from '../../core/exports'
import { sortItems } from '../../core/vocab'
import type { VocabItem } from '../../types/document'
import { dayKeyLocal } from '../../core/activity'
import { buildArticlePackage } from '../../core/articlePackage'
import { writingHistoryToMarkdown } from '../../core/writingExport'
import type { ExportParams } from './exportTypes'

/** 下载 / 词表 / 文章包等“生成文件”动作；不读写应用状态。 */
export function createExportFiles({ library, saved, learning, writingHistory, visibleBatch, flash }: ExportParams) {
  const { sessions, studyDays, activity, practice, mistakes, retells, studiedDays, skimmed, kindStats, answerEvents, goldenDrills, readDone, readGoal, goalMemo } =
    learning

  const download = (name: string, content: string, mime: string) => {
    const url = URL.createObjectURL(new Blob([content], { type: mime }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  const doExportAnki = (items: VocabItem[], name?: string) =>
    download(`${name ? name + '-' : ''}vocab-anki.csv`, toAnkiCSV(sortItems(items, 'word')), 'text/csv;charset=utf-8')

  const exportJson = () => download('vocab.json', exportLibraryJSON(library), 'application/json')

  /** 导出纯单词表 TXT（每行一个；默认跳过词组），给外部词书 App 导入。 */
  const exportWordList = (items: VocabItem[], name?: string, opts?: { includePhrases?: boolean }) =>
    download(
      `${name ? name + '-' : ''}wordlist.txt`,
      toWordListTXT(items, opts),
      'text/plain;charset=utf-8',
    )

  const exportBatch = () =>
    download(
      'picked-words.csv',
      toWordsCSV(visibleBatch.map((b) => ({ word: b.word, context: b.sentence }))),
      'text/csv;charset=utf-8',
    )

  const doExportWrong = (items: VocabItem[]) =>
    download('wrong-words.csv', toWrongWordsCSV(items), 'text/csv;charset=utf-8')

  /**
   * 导出仿写 / 金句课考试的 AI 批改（Markdown）。
   *
   * 这些批改只存在 `writingHistory.feedback` 里，界面只在交卷时显示；导出来才能存档 / 打印。
   * 没有记录时只提示，不生成空文件。
   */
  const exportWriting = () => {
    if (!writingHistory.length) {
      flash('还没有仿写 / 金句课考试的批改记录')
      return
    }
    const day = dayKeyLocal()
    download(`writing-feedback-${day}.md`, writingHistoryToMarkdown(writingHistory), 'text/markdown;charset=utf-8')
    flash(`已导出 ${writingHistory.length} 条批改记录`)
  }

  /** 导出全部：词库 + 已保存的文章 + 统计，一个 JSON 换电脑用。 */
  const exportAll = () => {
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      library,
      articles: saved,
      stats: sessions,
      studyStats: studyDays,
      activity,
      writingHistory,
      backTranslations: learning.backTranslations,
      practice,
      mistakes,
      retells,
      studiedDays,
      skimmed,
      kindStats,
      answerEvents,
      goldenDrills,
      readDone,
      readGoal,
      goalMemo,
    }
    const day = dayKeyLocal()
    download(`economist-backup-${day}.json`, JSON.stringify(backup, null, 2), 'application/json')
  }

  /**
   * 导出文章包（单篇 / 多篇）：正文 + AI 结果 + 这篇的词条 / 语言点 + 能归属到这篇的学习记录。
   * 只认已保存文章（正文和 AI 结果在 SavedArticle 里）；没保存就提示先保存。
   */
  const doExportArticlePackage = (ids: string[]) => {
    const wanted = new Set(ids)
    const picked = saved.filter((a) => wanted.has(a.id))
    if (!picked.length) {
      flash('这篇还没保存：先点「保存」再导出文章包（文章包要带上正文和 AI 结果）')
      return
    }
    const pkg = buildArticlePackage({
      articles: saved,
      articleIds: picked.map((a) => a.id),
      library,
      learning: { ...learning, writingHistory },
    })
    const day = dayKeyLocal()
    const label = picked.length === 1 ? picked[0].title : `${picked.length}篇`
    const safe = label.replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40) || '文章'
    download(`文章包-${safe}-${day}.json`, JSON.stringify(pkg, null, 2), 'application/json')
    flash(`已导出文章包：${picked.length} 篇（含生词 / 语言点 / 相关记录）；另一台电脑用「合并导入」`)
  }

  return { download, doExportAnki, exportJson, exportWordList, exportBatch, doExportWrong, exportAll, exportWriting, doExportArticlePackage }
}
