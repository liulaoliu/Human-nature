import type { RefObject } from 'react'
import { exportLibraryJSON, renderPrintHTML, toAnkiCSV, toWordListTXT, toWordsCSV, toWrongWordsCSV } from '../../core/exports'
import { groupItems, markPrinted, sortItems } from '../../core/vocab'
import { markArticlePrinted } from '../../core/articleVocab'
import type { VocabItem, VocabLibrary } from '../../types/document'
import type { PrintRow } from '../../core/printPlan'
import type { ArticleRepoPort, SavedArticle } from '../../core/ports'
import { dayKeyLocal } from '../../core/activity'
import { writeJson, readRaw, writeRaw } from '../storage'
import { backupFingerprint, hasImported, parseImportLedger, rememberImport } from '../../core/importLedger'
import type { WritingRecord } from '../../core/writing'
import { mergeReadDone } from '../../core/goals'
import type { LearningCollections, LearningSetters } from './useLearningData'
import {
  mergeActivity,
  mergeAnswerEvents,
  mergeBackTranslations,
  mergeKindStats,
  mergeGoldenDrills,
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
import { mergeGoldenIntoArticle } from '../../core/goldenParse'
import { ARTICLE_PACKAGE_FORMAT, buildArticlePackage } from '../../core/articlePackage'

/** 文章包走「合并导入」；覆盖导入会把整库清成只剩这一篇。 */
function isArticlePackage(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && (raw as { format?: unknown }).format === ARTICLE_PACKAGE_FORMAT
}

/** 一份备份里解析出来的各项数据（缺的字段为 undefined / 空）。 */
export interface UseExportParams {
  articles: RefObject<ArticleRepoPort | null>
  library: VocabLibrary
  saved: SavedArticle[]
  /** 学习记录快照（useLearningData.data） */
  learning: LearningCollections
  /** 合并导入用的写动作（useLearningData.setters） */
  setters: LearningSetters
  writingHistory: WritingRecord[]
  visibleBatch: { word: string; sentence: string }[]
  persist: (library: VocabLibrary) => void
  /** 立刻写入并等结果（导入备份用；失败会抛给调用方） */
  persistNow: (library: VocabLibrary) => Promise<void>
  flash: (message: string) => void
  setSaved: (list: SavedArticle[]) => void
  setWritingHistory: (v: WritingRecord[]) => void
}

/** 导出（Anki/JSON/CSV/打印）与整库备份的导出/导入。 */
export function useExport({
  articles,
  library,
  saved,
  learning,
  setters,
  writingHistory,
  visibleBatch,
  persist,
  persistNow,
  flash,
  setSaved,
  setWritingHistory,
}: UseExportParams) {
  // 展开成旧名字：函数体不动，参数从 30 个降到 11 个
  const { sessions, studyDays, activity, practice, mistakes, retells, studiedDays, skimmed, kindStats, answerEvents, goldenDrills, backTranslations, readDone, readGoal, goalMemo } =
    learning
  const {
    setSessions,
    setStudyDays,
    setActivity,
    setPractice,
    setMistakes,
    setRetells,
    setStudiedDays,
    setSkimmed,
    setKindStats,
    setAnswerEvents,
    setGoldenDrills,
    setBackTranslations,
    setReadDone,
    setReadGoal,
    setGoalMemo,
  } = setters
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
      backTranslations,
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

  /** 导入备份（覆盖）：词库整库替换、统计整段替换，文章按 id 写入。 */
  const onImportBackup = async (file: File | null | undefined) => {
    if (!file) return
    let phase: 'parse' | 'write' = 'parse'
    try {
      const raw = JSON.parse(await file.text())
      if (isArticlePackage(raw)) {
        flash('这是「文章包」，请改用「合并导入」：覆盖导入会把词库清成只剩这一篇')
        return
      }
      const parsed = parseBackupPayload(raw)
      phase = 'write'
      for (const a of parsed.articles) {
        if (a && a.id && Array.isArray(a.sentences) && Array.isArray(a.paragraphs)) {
          const existing = (await articles.current?.get(a.id)) ?? null
          await articles.current?.save(mergeGoldenIntoArticle(existing, a))
        }
      }
      if (parsed.library) {
        // 先等词库真正落盘，再改统计：写失败时数据保持原样，用户可以重试同一份文件。
        await persistNow(parsed.library)
        // 整库被替换了：清掉「语言点已收」记账，让文章里的语言点重新收一遍（不然会以为收过而不再补）
        writeJson('reader:langCollected', {})
      }
      if (parsed.sessions) setSessions(parsed.sessions)
      if (parsed.studyDays) setStudyDays(parsed.studyDays)
      if (parsed.activity) setActivity(parsed.activity)
      if (parsed.writingHistory) setWritingHistory(parsed.writingHistory)
      if (parsed.backTranslations) setBackTranslations(parsed.backTranslations)
      if (parsed.practice) setPractice(parsed.practice)
      if (parsed.mistakes) setMistakes(parsed.mistakes)
      if (parsed.retells) setRetells(parsed.retells)
      if (parsed.studiedDays) setStudiedDays(parsed.studiedDays)
      if (parsed.skimmed) setSkimmed(parsed.skimmed)
      if (parsed.kindStats) setKindStats(parsed.kindStats)
      if (parsed.answerEvents) setAnswerEvents(parsed.answerEvents)
      if (parsed.goldenDrills) setGoldenDrills(parsed.goldenDrills)
      if (parsed.readDone) setReadDone(parsed.readDone)
      if (typeof parsed.readGoal === 'number') setReadGoal(parsed.readGoal)
      if (typeof parsed.goalMemo === 'string') setGoalMemo(parsed.goalMemo)
      setSaved((await articles.current?.list()) ?? [])
      flash(
        `导入完成：文章 ${parsed.articles.length} 篇${parsed.library ? `，生词 ${parsed.library.items.length} 个` : ''}` +
          (parsed.dropped ? `（跳过 ${parsed.dropped} 条无效数据）` : ''),
      )
    } catch (e) {
      console.warn('[备份] 导入失败', e)
      flash(
        phase === 'parse'
          ? '导入失败：不是有效的 JSON 备份'
          : '导入失败：写入本机/服务端出错，数据未改动，可稍后重试',
      )
    }
  }

  /** 合并导入：保留现有数据，把备份并进来（词库按 lemma 去重、统计按天累加、错题按 id 累加）。 */
  const onMergeBackup = async (file: File | null | undefined) => {
    if (!file) return
    let phase: 'parse' | 'write' = 'parse'
    try {
      const text = await file.text()
      const fingerprint = backupFingerprint(text)
      const ledger = parseImportLedger(readRaw('reader:importedBackups'))
      if (hasImported(ledger, fingerprint)) {
        flash('这份备份已经合并导入过，已跳过（避免学习时长/活动重复累加）')
        return
      }
      const parsed = parseBackupPayload(JSON.parse(text))
      phase = 'write'
      let added = 0
      for (const a of parsed.articles) {
        if (a && a.id && Array.isArray(a.sentences) && Array.isArray(a.paragraphs)) {
          const existing = (await articles.current?.get(a.id)) ?? null
          await articles.current?.save(mergeGoldenIntoArticle(existing, a))
          added += 1
        }
      }
      const mergedLib = parsed.library ? mergeLibraries(library, parsed.library) : null
      // 关键顺序：词库真正落盘成功之后，才写学习统计和「这份文件已导入」指纹。
      // 否则 409 / 断网时指纹已经记上，用户再导入同一份文件会被去重直接跳过。
      if (mergedLib) await persistNow(mergedLib)
      if (parsed.sessions) setSessions(mergeSessions(sessions, parsed.sessions))
      if (parsed.studyDays) setStudyDays(mergeStudyDays(studyDays, parsed.studyDays))
      if (parsed.activity) setActivity(mergeActivity(activity, parsed.activity))
      if (parsed.writingHistory) setWritingHistory(mergeWritingHistory(writingHistory, parsed.writingHistory))
      if (parsed.backTranslations) setBackTranslations(mergeBackTranslations(backTranslations, parsed.backTranslations))
      if (parsed.practice) setPractice(mergePractice(practice, parsed.practice))
      if (parsed.mistakes) setMistakes(mergeMistakes(mistakes, parsed.mistakes))
      if (parsed.retells) setRetells(mergeRetells(retells, parsed.retells))
      if (parsed.studiedDays) setStudiedDays(mergeStudiedDays(studiedDays, parsed.studiedDays))
      if (parsed.skimmed) setSkimmed(mergeSkimmed(skimmed, parsed.skimmed))
      if (parsed.kindStats) setKindStats(mergeKindStats(kindStats, parsed.kindStats))
      if (parsed.answerEvents) setAnswerEvents(mergeAnswerEvents(answerEvents, parsed.answerEvents))
      if (parsed.goldenDrills) setGoldenDrills(mergeGoldenDrills(goldenDrills, parsed.goldenDrills))
      if (parsed.readDone) setReadDone(mergeReadDone(readDone, parsed.readDone))
      setSaved((await articles.current?.list()) ?? [])
      writeRaw('reader:importedBackups', JSON.stringify(rememberImport(ledger, fingerprint)))
      flash(
        `合并完成：文章 ${added} 篇${mergedLib ? `，生词共 ${mergedLib.items.length} 个` : ''}` +
          (parsed.dropped ? `（跳过 ${parsed.dropped} 条无效数据）` : ''),
      )
    } catch (e) {
      console.warn('[备份] 合并导入失败', e)
      flash(
        phase === 'parse'
          ? '合并失败：不是有效的 JSON 备份'
          : '合并失败：写入本机/服务端出错，未记导入指纹，可稍后重试同一份文件',
      )
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

  /**
   * 按「行」打印（每行自带篇 / 篇内编号）。同一词在不同篇各打一次，
   * 打印时间也记回各自的按篇条目，不再拿全库 lastPrintedAt 统一刷。
   */
  const doPrintRows = (rows: PrintRow[], title: string, opts?: { mark?: boolean }) => {
    if (!rows.length) {
      flash('没有可打印的词')
      return
    }
    // 同一篇的行放一组（篇内编号已由 planPrint 算好）；只有一篇时不加小标题
    const distinct = new Set(rows.map((r) => r.articleId).filter(Boolean))
    const rowGroups: { key: string; rows: PrintRow[] }[] = []
    if (distinct.size <= 1) rowGroups.push({ key: '', rows })
    else {
      const byArticle = new Map<string, PrintRow[]>()
      for (const row of rows) {
        const key = row.articleId || ''
        const list = byArticle.get(key)
        if (list) list.push(row)
        else byArticle.set(key, [row])
      }
      for (const list of byArticle.values()) {
        const name = list[0]?.articleTitle || list[0]?.articleId || '未分类'
        rowGroups.push({ key: `${name}（${list.length}）`, rows: list })
      }
    }

    const day = dayKeyLocal()
    const html = renderPrintHTML({
      title,
      groups: [],
      rowGroups,
      subtitle: `${day} · ${rows.length} 词`,
    })
    const win = window.open('', '_blank')
    if (!win) {
      flash('弹窗被拦截，允许后重试')
      return
    }
    win.document.write(html)
    win.document.close()
    if (opts?.mark !== false) {
      let lib = library
      const globalIds: string[] = []
      const byArticle = new Map<string, string[]>()
      for (const row of rows) {
        if (row.articleId) {
          const list = byArticle.get(row.articleId)
          if (list) list.push(row.item.lemma)
          else byArticle.set(row.articleId, [row.item.lemma])
        } else {
          globalIds.push(row.item.id)
        }
      }
      for (const [articleId, lemmas] of byArticle) lib = markArticlePrinted(lib, articleId, lemmas)
      if (globalIds.length) lib = markPrinted(lib, globalIds)
      persist(lib)
    }
  }

  return { download, doExportAnki, exportJson, exportWordList, exportBatch, doExportWrong, exportAll, doExportArticlePackage, onImportBackup, onMergeBackup, doPrint, doPrintRows }
}
