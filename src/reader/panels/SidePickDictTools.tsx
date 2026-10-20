export interface SidePickDictToolsProps {
  /** 离线词典（ECDICT）是否就绪。 */
  dictReady: boolean
  onPickFromDict: () => void
  onEnrichFromDict: () => void
  onFixLemmasFromDict: () => void
  onConfuseFromDict: () => void
  /** 离线例句库是否已加载。 */
  examplesReady: boolean
  onEnrichExamples: () => void
}

/** 离线词典 / 例句工具条：整篇挑词、补音标释义、校正原形、补混淆项、补例句。 */
export default function SidePickDictTools({
  dictReady,
  onPickFromDict,
  onEnrichFromDict,
  onFixLemmasFromDict,
  onConfuseFromDict,
  examplesReady,
  onEnrichExamples,
}: SidePickDictToolsProps) {
  return (
    <div className="dict-tools">
      <div className="muted">📖 离线词典：{dictReady ? '已就绪（ECDICT）' : '未加载（跑 npm run ecdict:build）'}</div>
      <div className="muted">
        🗣 离线例句：{examplesReady ? '已就绪（Tatoeba，建词自动补 3 条）' : '未安装（跑 npm run tatoeba:build）'}
      </div>
      <div className="bar">
        <button
          onClick={onPickFromDict}
          disabled={!dictReady}
          title="按当前词汇标准，用词典从本篇正文挑超纲词进「待选」（不用 AI）"
        >
          本篇挑词
        </button>
        <button
          onClick={onEnrichFromDict}
          disabled={!dictReady}
          title="给生词本补齐音标/词性/中英文释义（词典有的才补）"
        >
          补齐生词本
        </button>
        <button
          onClick={onFixLemmasFromDict}
          disabled={!dictReady}
          title="用词典校正原形（running→run）并去重"
        >
          校正原形
        </button>
        <button
          onClick={onConfuseFromDict}
          disabled={!dictReady}
          title="用词典给缺混淆项的词本地生成干扰项（拼写形近、含义不同）"
        >
          补混淆项
        </button>
        <button
          onClick={onEnrichExamples}
          title="从离线例句库（Tatoeba）给「还没有例句」的本篇生词批量补真实例句；需先跑 tools/build-tatoeba.mjs"
        >
          📖 补离线例句
        </button>
      </div>
    </div>
  )
}
