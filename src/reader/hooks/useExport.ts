import type { RefObject } from 'react'
import { exportLibraryJSON, renderPrintHTML, toAnkiCSV, toWordsCSV, toWrongWordsCSV } from '../../core/exports'
import { groupItems, sortItems } from '../../core/vocab'
import type { VocabItem, VocabLibrary } from '../../types/document'
import type { ArticleRepoPort, SavedArticle } from '../../adapters/articleRepo'
import type { PickSession, StudyDay } from '../../core/vocabStats'
import type { DayActivity } from '../../core/activity'
import type { WritingRecord } from '../../core/writing'
import type { PracticeRecord } from '../../core/practice'
import type { MistakeEntry } from '../../core/mistakes'

export interface UseExportParams {
  articles: RefObject<ArticleRepoPort | null>
  library: VocabLibrary
  saved: SavedArticle[]
  sessions: PickSession[]
  studyDays: StudyDay[]
  activity: DayActivity[]
  writingHistory: WritingRecord[]
  practice: PracticeRecord[]
  mistakes: MistakeEntry[]
  visibleBatch: { word: string; sentence: string }[]
  persist: (library: VocabLibrary) => void
  flash: (message: string) => void
  setSaved: (list: SavedArticle[]) => void
  setSessions: (v: PickSession[]) => void
  setStudyDays: (v: StudyDay[]) => void
  setActivity: (v: DayActivity[]) => void
  setWritingHistory: (v: WritingRecord[]) => void
  setPractice: (v: PracticeRecord[]) => void
  setMistakes: (v: MistakeEntry[]) => void
}

/** 导出（Anki/JSON/CSV/打印）与整库备份的导出/导入。 */
export function useExport({
  articles,
  library,
  saved,
  sessions,
  studyDays,
  activity,
  writingHistory,
  practice,
  mistakes,
  visibleBatch,
  persist,
  flash,
  setSaved,
  setSessions,
  setStudyDays,
  setActivity,
  setWritingHistory,
  setPractice,
  setMistakes,
}: UseExportParams) {
  const download = (name: string, content: string, mime: string) => {
    const url = URL.createObjectURL(new Blob([content], { type: mime }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  const doExportAnki = (items: VocabItem[]) =>
    download('vocab-anki.csv', toAnkiCSV(sortItems(items, 'word')), 'text/csv;charset=utf-8')

  const exportJson = () => download('vocab.json', exportLibraryJSON(library), 'application/json')

  const exportBatch = () =>
    download(
      'picked-words.csv',
      toWordsCSV(visibleBatch.map((b) => ({ word: b.word, context: b.sentence }))),
      'text/csv;charset=utf-8',
    )

  const doExportWrong = (items: VocabItem[]) =>
    download('wrong-words.csv', toWrongWordsCSV(items), 'text/csv;charset=utf-8')

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
      practice,
      mistakes,
    }
    const day = new Date().toISOString().slice(0, 10)
    download(`economist-backup-${day}.json`, JSON.stringify(backup, null, 2), 'application/json')
  }

  /** 导入备份：兼容「全部备份」「词库 JSON」「文章数组」「单篇」。 */
  const onImportBackup = async (file: File | null | undefined) => {
    if (!file) return
    try {
      const data: unknown = JSON.parse(await file.text())
      let imported: SavedArticle[] = []
      let importedLib: VocabLibrary | null = null
      if (Array.isArray(data)) {
        if (data.length && data[0] && typeof data[0] === 'object' && 'sentences' in data[0]) {
          imported = data as SavedArticle[]
        } else if (data.length && data[0] && typeof data[0] === 'object' && 'lemma' in data[0]) {
          importedLib = { schemaVersion: 1, items: data as VocabLibrary['items'] }
        }
      } else if (data && typeof data === 'object') {
        const obj = data as Record<string, unknown>
        if (Array.isArray(obj.articles)) imported = obj.articles as SavedArticle[]
        if (obj.library && typeof obj.library === 'object' && Array.isArray((obj.library as VocabLibrary).items)) {
          importedLib = obj.library as VocabLibrary
        } else if (Array.isArray(obj.items)) {
          importedLib = data as VocabLibrary
        }
        if (Array.isArray(obj.stats)) setSessions(obj.stats as PickSession[])
        if (Array.isArray(obj.studyStats)) setStudyDays(obj.studyStats as StudyDay[])
        if (Array.isArray(obj.activity)) setActivity(obj.activity as DayActivity[])
        if (Array.isArray(obj.writingHistory)) setWritingHistory(obj.writingHistory as WritingRecord[])
        if (Array.isArray(obj.practice)) setPractice(obj.practice as PracticeRecord[])
        if (Array.isArray(obj.mistakes)) setMistakes(obj.mistakes as MistakeEntry[])
        if (!imported.length && 'sentences' in obj && 'paragraphs' in obj) imported = [data as SavedArticle]
      }
      for (const a of imported) {
        if (a && a.id && Array.isArray(a.sentences) && Array.isArray(a.paragraphs)) {
          await articles.current?.save(a)
        }
      }
      if (importedLib) persist(importedLib)
      setSaved((await articles.current?.list()) ?? [])
      flash(`导入完成：文章 ${imported.length} 篇${importedLib ? `，生词 ${importedLib.items.length} 个` : ''}`)
    } catch {
      flash('导入失败：不是有效的 JSON 备份')
    }
  }

  /** A4 打印（弹新窗口）。 */
  const doPrint = (items: VocabItem[], title: string, numberOf?: (it: VocabItem) => number | null) => {
    const sorted = numberOf
      ? [...items].sort((a, b) => (numberOf(a) ?? 1e9) - (numberOf(b) ?? 1e9))
      : sortItems(items, 'word')
    const groups = numberOf ? [{ key: '', items: sorted }] : groupItems(sorted, 'alphabet')
    const day = new Date().toISOString().slice(0, 10)
    const html = renderPrintHTML({
      title,
      groups,
      subtitle: `${day} · ${items.length} 词`,
      numberOf,
    })
    const win = window.open('', '_blank')
    if (!win) {
      flash('弹窗被拦截，允许后重试')
      return
    }
    win.document.write(html)
    win.document.close()
  }

  return { download, doExportAnki, exportJson, exportBatch, doExportWrong, exportAll, onImportBackup, doPrint }
}
