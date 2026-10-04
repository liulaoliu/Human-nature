import mascotAI from '../../../assets/imgs/GinShinImapct.png'

export interface ComposerProps {
  /** 是否处于「新建/导入」态（有文章时为可取消的浮层）。 */
  composing: boolean
  onCancel: () => void
  title: string
  onTitleChange: (value: string) => void
  book: string
  onBookChange: (value: string) => void
  manual: string
  onManualChange: (value: string) => void
  pdfRange: string
  onPdfRangeChange: (value: string) => void
  importing: string
  onImportFiles: (files: FileList | null) => void
  onPickPdf: (file: File | undefined) => void
  onPickEpub: (file: File | undefined) => void
  onCleanupPrompt: () => void
  onCreate: () => void
}

/** 新建 / 导入文章：粘正文，或导入 .txt/.md（多选）、.pdf（可页码范围）、.epub（按章拆）。 */
export default function Composer({
  composing,
  onCancel,
  title,
  onTitleChange,
  book,
  onBookChange,
  manual,
  onManualChange,
  pdfRange,
  onPdfRangeChange,
  importing,
  onImportFiles,
  onPickPdf,
  onPickEpub,
  onCleanupPrompt,
  onCreate,
}: ComposerProps) {
  return (
    <div className="composer">
      <img className="composer-mascot" src={mascotAI} alt="" />
      <div className="bar">
        <input
          className="title-input"
          placeholder="文章标题（可留空）"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
        />
        <input
          className="title-input book-input"
          placeholder="书名（可选，用于分组）"
          value={book}
          onChange={(e) => onBookChange(e.target.value)}
        />
        <label className="filebtn" title="读入本地 .txt / .md，可多选（每个文件一篇）">
          选择文件
          <input
            type="file"
            accept=".txt,.md,.markdown,text/plain"
            multiple
            onChange={(e) => {
              onImportFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </label>
        <input
          className="title-input range-input"
          placeholder="页码范围 14-16（留空=整本）"
          value={pdfRange}
          onChange={(e) => onPdfRangeChange(e.target.value)}
          title="只抽这几页；留空抽整本"
        />
        <label className="filebtn" title="浏览器内解析 PDF 文本（扫描件无文字层则读不出）">
          选择 PDF
          <input
            type="file"
            accept=".pdf,application/pdf"
            onChange={(e) => {
              onPickPdf(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
        <label className="filebtn" title="解析 EPUB，按章拆成多篇保存">
          选择 EPUB
          <input
            type="file"
            accept=".epub,application/epub+zip"
            onChange={(e) => {
              onPickEpub(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
        <button
          onClick={onCleanupPrompt}
          disabled={!manual.trim()}
          title="复制一段提示词：让 AI 去掉这段复制文本的多余换行、粘连和错误"
        >
          生成清洗提示词
        </button>
        <button className="primary" onClick={onCreate} disabled={!manual.trim()}>
          创建文章
        </button>
        {composing && <button onClick={onCancel}>取消</button>}
        {importing && <span className="muted">{importing}</span>}
      </div>
      <textarea
        className="manual"
        placeholder="把英文正文粘在这里（或点「选择文件」导入），再点「创建文章」"
        value={manual}
        onChange={(e) => onManualChange(e.target.value)}
      />
    </div>
  )
}
