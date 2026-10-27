import { useMemo } from 'react'
import {
  buildGoldenBank,
  goldenBankToAnkiCSV,
  goldenBankToMarkdown,
  goldenBankToPrintHTML,
  type GoldenBankRow,
} from '../../core/goldenBank'
import type { GoldenDrillRecord } from '../../core/goldenProgress'
import type { GoldenLesson, SavedArticle } from '../../types/document'
import type { ReaderDoc } from './useReaderDoc'

interface GoldenBankArgs {
  saved: SavedArticle[]
  savedId: string | null
  articleKey: string | null
  articleTitle: string
  articleIdentity: string
  doc: ReaderDoc | null
  lesson: GoldenLesson | null
  records: GoldenDrillRecord[]
  download: (name: string, data: string, mime: string) => void
  flash: (msg: string) => void
}

export interface GoldenBankApi {
  rows: GoldenBankRow[]
  exportMarkdown: () => void
  exportAnki: () => void
  printBank: () => void
  printLesson: () => void
}

/**
 * 全库金句本 + 本课打印 / 导出。
 *
 * 只读摊平 `SavedArticle.golden` 和 `goldenDrills`，不写库；ReaderApp 只负责把回调接进模型。
 */
export function useGoldenBank({
  saved,
  savedId,
  articleKey,
  articleTitle,
  articleIdentity,
  doc,
  lesson,
  records,
  download,
  flash,
}: GoldenBankArgs): GoldenBankApi {
  const rows = useMemo(() => {
    const currentId = savedId ?? articleKey ?? articleTitle ?? articleIdentity
    const sources = saved.map((a) => ({
      id: a.id,
      title: a.title,
      sentences: a.sentences,
      ...(a.golden ? { golden: a.golden } : {}),
    }))
    const currentLesson = doc ? doc.golden ?? lesson : null
    if (doc && currentLesson) {
      const current = { id: currentId, title: articleTitle || '未命名', sentences: doc.sentences, golden: currentLesson }
      const at = sources.findIndex((s) => s.id === currentId)
      if (at >= 0) sources[at] = current
      else sources.push(current)
    }
    return buildGoldenBank(sources, records)
  }, [saved, savedId, articleKey, articleTitle, articleIdentity, doc, lesson, records])

  const printHTML = (title: string, html: string) => {
    const win = window.open('', '_blank')
    if (!win) {
      flash('弹窗被拦截，允许后重试')
      return
    }
    win.document.write(html)
    win.document.close()
    win.document.title = title
  }

  return {
    rows,
    exportMarkdown: () => {
      if (!rows.length) {
        flash('还没有金句可导出')
        return
      }
      download('全库金句本.md', goldenBankToMarkdown(rows), 'text/markdown;charset=utf-8')
    },
    exportAnki: () => {
      if (!rows.length) {
        flash('还没有金句可导出')
        return
      }
      download('全库金句本-anki.csv', goldenBankToAnkiCSV(rows), 'text/csv;charset=utf-8')
    },
    printBank: () => {
      if (!rows.length) {
        flash('还没有金句可打印')
        return
      }
      printHTML('全库金句本', goldenBankToPrintHTML(rows))
    },
    printLesson: () => {
      if (!doc || !lesson) {
        flash('先打开一篇金句课')
        return
      }
      const lessonRows = buildGoldenBank(
        [
          {
            id: articleKey || articleTitle || articleIdentity,
            title: articleTitle || '未命名',
            sentences: doc.sentences,
            golden: lesson,
          },
        ],
        records,
      )
      if (!lessonRows.length) {
        flash('本课还没有可打印的金句')
        return
      }
      printHTML(articleTitle || 'D老师小课堂', goldenBankToPrintHTML(lessonRows, articleTitle || 'D老师小课堂'))
    },
  }
}
