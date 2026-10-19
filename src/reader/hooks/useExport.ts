import type { RefObject } from 'react'
import { exportLibraryJSON, renderPrintHTML, toAnkiCSV, toWordListTXT, toWordsCSV, toWrongWordsCSV } from '../../core/exports'
import { groupItems, markPrinted, sortItems } from '../../core/vocab'
import type { VocabItem, VocabLibrary } from '../../types/document'
import type { ArticleRepoPort, SavedArticle } from '../../core/ports'
import type { PickSession, StudyDay } from '../../core/vocabStats'
import type { DayActivity } from '../../core/activity'
import { dayKeyLocal } from '../../core/activity'
import { writeJson } from '../storage'
import type { WritingRecord } from '../../core/writing'
import type { PracticeRecord } from '../../core/practice'
import type { MistakeEntry } from '../../core/mistakes'
import { mergeReadDone, type ReadDone } from '../../core/goals'
import type { KindStats, RetellRecord, StudiedDay } from '../../core/learning'
import {
  mergeActivity,
  mergeKindStats,
  mergeLibraries,
  mergeMistakes,
  mergePractice,
  mergeRetells,
  mergeSessions,
  mergeSkimmed,
  mergeStudiedDays,
  mergeStudyDays,
  mergeWritingHistory,
} from '../../core/mergeBackup'
import { parseBackupPayload } from '../../core/backupParse'

/** 一份备份里解析出来的各项数据（缺的字段为 undefined / 空）。 */
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
  retells: RetellRecord[]
  studiedDays: StudiedDay[]
  skimmed: string[]
  kindStats: KindStats
  readDone: ReadDone[]
  readGoal: number
  goalMemo: string
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
  setRetells: (v: RetellRecord[]) => void
  setStudiedDays: (v: StudiedDay[]) => void
  setSkimmed: (v: string[]) => void
  setKindStats: (v: KindStats) => void
  setReadDone: (v: ReadDone[]) => void
  setReadGoal: (v: number) => void
  setGoalMemo: (v: string) => void
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
  retells,
  studiedDays,
  skimmed,
  kindStats,
  readDone,
  readGoal,
  goalMemo,
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
  setRetells,
  setStudiedDays,
  setSkimmed,
  setKindStats,
  setReadDone,
  setReadGoal,
  setGoalMemo,
}: UseExportParams) {
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
      retells,
      studiedDays,
      skimmed,
      kindStats,
      readDone,
      readGoal,
      goalMemo,
    }
    const day = dayKeyLocal()
    download(`economist-backup-${day}.json`, JSON.stringify(backup, null, 2), 'application/json')
  }

  /** 导入备份（覆盖）：词库整库替换、统计整段替换，文章按 id 写入。 */
  const onImportBackup = async (file: File | null | undefined) => {
    if (!file) return
    try {
      const parsed = parseBackupPayload(JSON.parse(await file.text()))
      for (const a of parsed.articles) {
        if (a && a.id && Array.isArray(a.sentences) && Array.isArray(a.paragraphs)) {
          await articles.current?.save(a)
        }
      }
      if (parsed.library) {
        persist(parsed.library)
        // 整库被替换了：清掉「语言点已收」记账，让文章里的语言点重新收一遍（不然会以为收过而不再补）
        writeJson('reader:langCollected', {})
      }
      if (parsed.sessions) setSessions(parsed.sessions)
      if (parsed.studyDays) setStudyDays(parsed.studyDays)
      if (parsed.activity) setActivity(parsed.activity)
      if (parsed.writingHistory) setWritingHistory(parsed.writingHistory)
      if (parsed.practice) setPractice(parsed.practice)
      if (parsed.mistakes) setMistakes(parsed.mistakes)
      if (parsed.retells) setRetells(parsed.retells)
      if (parsed.studiedDays) setStudiedDays(parsed.studiedDays)
      if (parsed.skimmed) setSkimmed(parsed.skimmed)
      if (parsed.kindStats) setKindStats(parsed.kindStats)
      if (parsed.readDone) setReadDone(parsed.readDone)
      if (typeof parsed.readGoal === 'number') setReadGoal(parsed.readGoal)
      if (typeof parsed.goalMemo === 'string') setGoalMemo(parsed.goalMemo)
      setSaved((await articles.current?.list()) ?? [])
      flash(
        `导入完成：文章 ${parsed.articles.length} 篇${parsed.library ? `，生词 ${parsed.library.items.length} 个` : ''}` +
          (parsed.dropped ? `（跳过 ${parsed.dropped} 条无效数据）` : ''),
      )
    } catch {
      flash('导入失败：不是有效的 JSON 备份')
    }
  }

  /** 合并导入：保留现有数据，把备份并进来（词库按 lemma 去重、统计按天累加、错题按 id 累加）。 */
  const onMergeBackup = async (file: File | null | undefined) => {
    if (!file) return
    try {
      const parsed = parseBackupPayload(JSON.parse(await file.text()))
      let added = 0
      for (const a of parsed.articles) {
        if (a && a.id && Array.isArray(a.sentences) && Array.isArray(a.paragraphs)) {
          await articles.current?.save(a)
          added += 1
        }
      }
      const mergedLib = parsed.library ? mergeLibraries(library, parsed.library) : null
      if (mergedLib) persist(mergedLib)
      if (parsed.sessions) setSessions(mergeSessions(sessions, parsed.sessions))
      if (parsed.studyDays) setStudyDays(mergeStudyDays(studyDays, parsed.studyDays))
      if (parsed.activity) setActivity(mergeActivity(activity, parsed.activity))
      if (parsed.writingHistory) setWritingHistory(mergeWritingHistory(writingHistory, parsed.writingHistory))
      if (parsed.practice) setPractice(mergePractice(practice, parsed.practice))
      if (parsed.mistakes) setMistakes(mergeMistakes(mistakes, parsed.mistakes))
      if (parsed.retells) setRetells(mergeRetells(retells, parsed.retells))
      if (parsed.studiedDays) setStudiedDays(mergeStudiedDays(studiedDays, parsed.studiedDays))
      if (parsed.skimmed) setSkimmed(mergeSkimmed(skimmed, parsed.skimmed))
      if (parsed.kindStats) setKindStats(mergeKindStats(kindStats, parsed.kindStats))
      if (parsed.readDone) setReadDone(mergeReadDone(readDone, parsed.readDone))
      setSaved((await articles.current?.list()) ?? [])
      flash(
        `合并完成：文章 ${added} 篇${mergedLib ? `，生词共 ${mergedLib.items.length} 个` : ''}` +
          (parsed.dropped ? `（跳过 ${parsed.dropped} 条无效数据）` : ''),
      )
    } catch {
      flash('合并失败：不是有效的 JSON 备份')
    }
  }

  /** A4 打印（弹新窗口）。成功后默认给这批词记上打印时间（opts.mark=false 可关掉）。 */
  const doPrint = (
    items: VocabItem[],
    title: string,
    numberOf?: (it: VocabItem) => number | null,
    opts?: { groupBy?: 'alphabet' | 'article' | 'date' | 'status'; mark?: boolean },
  ) => {
    if (!items.length) {
      flash('没有可打印的词')
      return
    }
    const sorted = numberOf
      ? [...items].sort((a, b) => (numberOf(a) ?? 1e9) - (numberOf(b) ?? 1e9))
      : sortItems(items, 'word')
    const groups = numberOf ? [{ key: '', items: sorted }] : groupItems(sorted, opts?.groupBy ?? 'alphabet')
    const day = dayKeyLocal()
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
    // 打印成功即记录时间，下次「只打未打印」可据此跳过。
    if (opts?.mark !== false) {
      persist(markPrinted(library, items.map((it) => it.id)))
    }
  }

  return { download, doExportAnki, exportJson, exportWordList, exportBatch, doExportWrong, exportAll, onImportBackup, onMergeBackup, doPrint }
}
