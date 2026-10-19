import { useEffect, useMemo, useRef, useState } from 'react'
import type { ArticleBook } from '../core/matchArticle'
import type { SavedArticle } from '../core/ports'
import { calendarDayKey } from '../core/activity'
import { useHotkeys } from './useHotkeys'

interface Props {
  book: ArticleBook | null
  saved: SavedArticle[]
  savedGroups: [string, SavedArticle[]][]
  builtinKeys: string[]
  currentValue: string
  onPick: (value: string) => void
  /** 文章标识（内置=book key，已保存=savedId）→ **第一次**读完的日期键 */
  readDays?: Record<string, string>
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
  readDays = {},
}: Props) {
  const [open, setOpen] = useState(false)
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [hideRead, setHideRead] = useState(false)
  /** 标题搜索：只在本组件内存里，不落 localStorage（关掉下拉即清空）。 */
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)

  const close = () => {
    setOpen(false)
    setQuery('')
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Esc 关下拉：走全局键盘分发，最高优先级（弹层打开时先关它）
  useHotkeys(
    (e) => {
      if (e.key === 'Escape') close()
    },
    open,
    100,
  )

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
    close()
  }

  /** 已读完（会带上「第一次读完」的日期）。 */
  const readOf = (id: string) => readDays[id]
  const q = query.trim().toLowerCase()
  const matchTitle = (title: string) => !q || title.toLowerCase().includes(q)
  const shownBuiltin = builtinKeys.filter((k) => matchTitle(k) && (!hideRead || !readOf(k)))
  const shownGroups: [string, SavedArticle[]][] = savedGroups
    .map(([name, list]): [string, SavedArticle[]] => [
      name,
      list.filter((a) => matchTitle(a.title) && (!hideRead || !readOf(a.id))),
    ])
    .filter(([, list]) => list.length > 0)

  const readBadge = (id: string) =>
    readOf(id) ? (
      <span className="picker-read" title={`已于 ${readOf(id)} 读完（同一篇不再重复计入）`}>
        ✓ {readOf(id).slice(5)}
      </span>
    ) : null

  return (
    <div className="picker" ref={rootRef}>
      <button
        className={'picker-btn' + (open ? ' open' : '')}
        onClick={() => (open ? close() : setOpen(true))}
        title="选择文章"
        aria-expanded={open}
      >
        <span className="picker-label">{label}</span>
        <span className={'caret' + (open ? ' up' : '')}>▾</span>
      </button>

      {open && (
        <div className="picker-pop" role="listbox">
          <div className="picker-search">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索文章标题…"
              aria-label="搜索文章标题"
              autoFocus
            />
          </div>

          <div className="picker-filter">
            <label className="check-inline" title="把已经读完的文章藏起来（同一篇不会重复计入）">
              <input type="checkbox" checked={hideRead} onChange={(e) => setHideRead(e.target.checked)} />
              只看未读
            </label>
            <span className="muted">
              已读 {Object.keys(readDays).length} 篇
              {hideRead ? ` · 未读 ${shownBuiltin.length + shownGroups.reduce((n, [, l]) => n + l.length, 0)} 篇` : ''}
            </span>
          </div>

          {book && shownBuiltin.length > 0 && (
            <div className="picker-section">
              <button className="picker-head" onClick={() => toggle('builtin')}>
                <span className={'caret' + (expanded('builtin') || q ? '' : ' closed')}>▾</span>
                内置（{shownBuiltin.length}）
              </button>
              {(expanded('builtin') || q) &&
                shownBuiltin.map((k) => (
                  <button
                    key={k}
                    className={'picker-item' + (currentValue === `b:${k}` ? ' on' : '') + (readOf(k) ? ' read' : '')}
                    onClick={() => choose(`b:${k}`)}
                    title={readOf(k) ? `${k}\n已读：${readOf(k)}` : k}
                  >
                    {k}
                    {readBadge(k)}
                  </button>
                ))}
            </div>
          )}

          {shownGroups.length > 0 && (
            <div className="picker-section">
              <button className="picker-head" onClick={() => toggle('saved')}>
                <span className={'caret' + (expanded('saved') || q ? '' : ' closed')}>▾</span>
                已保存（{shownGroups.reduce((n, [, l]) => n + l.length, 0)}）
              </button>
              {(expanded('saved') || q) &&
                shownGroups.map(([bookName, list]) => {
                  const gkey = `book:${bookName}`
                  const single = bookName === '单篇'
                  const isOpenGroup = expanded(gkey) || !!q
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
                        list.map((a) => {
                          const created = calendarDayKey(new Date(a.createdAt ?? a.updatedAt))
                          const edited = calendarDayKey(new Date(a.updatedAt))
                          return (
                            <button
                              key={a.id}
                              className={
                                'picker-item sub' + (currentValue === `s:${a.id}` ? ' on' : '') + (readOf(a.id) ? ' read' : '')
                              }
                              onClick={() => choose(`s:${a.id}`)}
                              title={`${a.title}\n新增：${created}${edited !== created ? `\n最后修改：${edited}` : ''}${
                                readOf(a.id) ? `\n已读：${readOf(a.id)}` : ''
                              }`}
                            >
                              <span className="picker-item-title">{single ? a.title : a.title.replace(`${bookName} · `, '')}</span>
                              <span className="picker-item-date">
                                {created}
                                {edited !== created ? ` · 改 ${edited}` : ''}
                              </span>
                              {readBadge(a.id)}
                            </button>
                          )
                        })}
                    </div>
                  )
                })}
            </div>
          )}

          {shownBuiltin.length === 0 && shownGroups.length === 0 && (
            <div className="muted picker-empty">{q ? '没搜到匹配的文章' : '都读完了 🎉'}</div>
          )}
        </div>
      )}
    </div>
  )
}
