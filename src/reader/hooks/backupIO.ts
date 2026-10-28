import { readRaw, writeRaw, writeJson } from '../storage'
import { backupFingerprint, hasImported, parseImportLedger, rememberImport } from '../../core/importLedger'
import { mergeReadDone } from '../../core/goals'
import {
  mergeActivity,
  mergeAnswerEvents,
  mergeBackTranslations,
  mergeGoldenDrills,
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
import { mergeGoldenIntoArticle } from '../../core/goldenParse'
import { ARTICLE_PACKAGE_FORMAT } from '../../core/articlePackage'
import type { ExportParams } from './exportTypes'

/** 文章包走「合并导入」；覆盖导入会把整库清成只剩这一篇。 */
function isArticlePackage(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && (raw as { format?: unknown }).format === ARTICLE_PACKAGE_FORMAT
}

/** 整库备份的覆盖导入 / 合并导入；外部文件先走 core 的解析守卫。 */
export function createBackupIO({
  articles,
  library,
  learning,
  setters,
  writingHistory,
  persistNow,
  flash,
  setSaved,
  setWritingHistory,
}: ExportParams) {
  const { sessions, studyDays, activity, practice, mistakes, retells, studiedDays, skimmed, kindStats, answerEvents, goldenDrills, readDone } =
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
      if (parsed.backTranslations) setBackTranslations(mergeBackTranslations(learning.backTranslations, parsed.backTranslations))
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

  return { onImportBackup, onMergeBackup }
}
