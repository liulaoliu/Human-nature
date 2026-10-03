import { useEffect, useMemo, useRef, useState } from 'react'
import type { ArticleBook } from '../core/matchArticle'
import type { SavedArticle } from '../adapters/articleRepo'

interface Props {
  book: ArticleBook | null
  saved: SavedArticle[]
  savedGroups: [string, SavedArticle[]][]
  builtinKeys: string[]
  currentValue: string
  onPick: (value: string) => void
}

/**
 * 文章选择器：自定义下拉，内置 / 已保存（按书）分组都可展开收起。
 * 原生 <select> 的 <optgroup> 不能折叠，所以自己画。
 */
export default function ArticlePicker({
  book,
  saved,
  savedGroups,
  builtinKeys,
  currentValue,
  onPick,
}: Props) {
  const [open, setOpen] = useState(false)
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const label = useMemo(() => {
    if (currentValue.startsWith('b:')) return currentValue.slice(2)
    if (currentValue.startsWith('s:')) {
      const a = saved.find((x) => x.id === currentValue.slice(2))
      return a ? a.title : '已保存文章'
    }
    return '选择文章…'
  }, [currentValue, saved])

  const toggle = (key: string) =>
    setClosed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const expanded = (key: string) => !closed.has(key)

  const choose = (value: string) => {
    onPick(value)
    setOpen(false)
  }

  return (
    <div className="picker" ref={rootRef}>
      <button className={'picker-btn' + (open ? ' open' : '')} onClick={() => setOpen((v) => !v)} title="选择文章">
        <span className="picker-label">{label}</span>
        <span className={'caret' + (open ? ' up' : '')}>▾</span>
      </button>

      {open && (
        <div className="picker-pop" role="listbox">
          {book && (
            <div className="picker-section">
              <button className="picker-head" onClick={() => toggle('builtin')}>
                <span className={'caret' + (expanded('builtin') ? '' : ' closed')}>▾</span>
                内置（{builtinKeys.length}）
              </button>
              {expanded('builtin') &&
                builtinKeys.map((k) => (
                  <button
                    key={k}
                    className={'picker-item' + (currentValue === `b:${k}` ? ' on' : '')}
                    onClick={() => choose(`b:${k}`)}
                    title={k}
                  >
                    {k}
                  </button>
                ))}
            </div>
          )}

          {savedGroups.length > 0 && (
            <div className="picker-section">
              <button className="picker-head" onClick={() => toggle('saved')}>
                <span className={'caret' + (expanded('saved') ? '' : ' closed')}>▾</span>
                已保存（{saved.length}）
              </button>
              {expanded('saved') &&
                savedGroups.map(([bookName, list]) => {
                  const gkey = `book:${bookName}`
                  const single = bookName === '单篇'
                  const isOpenGroup = expanded(gkey)
                  return (
                    <div key={gkey}>
                      <button
                        className="picker-sub"
                        onClick={() => (single ? undefined : toggle(gkey))}
                        disabled={single}
                        title={single ? '' : '展开 / 收起这本书'}
                      >
                        {!single && <span className={'caret' + (isOpenGroup ? '' : ' closed')}>▾</span>}
                        {single ? '单篇' : `📖 ${bookName}`}（{list.length}）
                      </button>
                      {(single || isOpenGroup) &&
                        list.map((a) => (
                          <button
                            key={a.id}
                            className={'picker-item sub' + (currentValue === `s:${a.id}` ? ' on' : '')}
                            onClick={() => choose(`s:${a.id}`)}
                            title={a.title}
                          >
                            {single ? a.title : a.title.replace(`${bookName} · `, '')}
                          </button>
                        ))}
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
