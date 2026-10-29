import { useLocalStorageState } from '../../hooks/useLocalStorageState'
import type { GoldenLangPointApi } from '../../hooks/useGoldenLangPoint'
import { langPointKey } from '../../../core/goldenLangPoint'
import GoldenLangPointAnswer from './GoldenLangPointAnswer'

/**
 * 本句的「语言点造句」：整句仿写之外的额外练习，可勾多个词块。
 *
 * 勾几个就出几个编号作答框，每个框各存一条记录（挂在这句上）。
 * 可选、不阻塞「下一句」；不影响句子掌握进度。中文显示走本机偏好 `reader:goldenLangZh`。
 */
export default function GoldenLangPointImitation({ langPoint }: { langPoint: GoldenLangPointApi }) {
  const [showZh, setShowZh] = useLocalStorageState<boolean>('reader:goldenLangZh', true)
  const { choices, selected, toggle } = langPoint
  if (!choices.length) return null

  const picked = new Set(selected.map(langPointKey))
  const chosen = selected
    .map((en) => choices.find((c) => langPointKey(c.en) === langPointKey(en)))
    .filter((c): c is (typeof choices)[number] => !!c)

  return (
    <div className="golden-lang-point">
      <div className="bar golden-plan-bar">
        <b>还是单独练语言点？</b>
        <span className="muted">本句 {choices.length} 个 · 可多选</span>
        <button
          onClick={() => setShowZh((v) => !v)}
          title={showZh ? '隐藏中文释义' : '显示中文释义'}
          aria-pressed={showZh}
        >
          {showZh ? '中 / EN' : 'EN'}
        </button>
      </div>
      <div className="golden-bank">
        {choices.map((c) => {
          const on = picked.has(langPointKey(c.en))
          return (
            <button
              key={c.en}
              className={on ? 'on' : ''}
              onClick={() => toggle(c.en)}
              aria-pressed={on}
              title={showZh && c.zh ? c.zh : c.en}
            >
              {showZh && c.zh ? `${c.en} — ${c.zh}` : c.en}
              {c.done ? ' ✓' : ''}
            </button>
          )
        })}
      </div>
      {chosen.length ? (
        <>
          <div className="muted">勾了几个就练几个，每句独立批改；不练也能直接下一句。</div>
          {chosen.map((c, i) => (
            <GoldenLangPointAnswer key={c.en} point={c} index={i} api={langPoint} showZh={showZh} />
          ))}
        </>
      ) : (
        <div className="muted">点上面的词块，勾几个就出几个输入框。</div>
      )}
    </div>
  )
}
