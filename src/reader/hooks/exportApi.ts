import { createBackupIO } from './backupIO'
import { createExportFiles } from './exportFiles'
import { createPrintActions } from './printActions'
import type { ExportParams } from './exportTypes'

export type { ExportParams } from './exportTypes'

/**
 * 导出 / 打印 / 备份导入。
 *
 * 普通 factory：没有 React 状态 / effect，三块动作各自有独立文件；
 * 调用方按需创建，不必为了命名一致包成 hook。
 */
export function createExport(params: ExportParams) {
  return {
    ...createExportFiles(params),
    ...createBackupIO(params),
    ...createPrintActions(params),
  }
}

/** 导出动作集合；给 props 类型用。 */
export type ExportApi = ReturnType<typeof createExport>
