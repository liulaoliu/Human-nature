import { useEffect, useState, type MutableRefObject } from 'react'

/**
 * 拼写输入草稿（正面拼写 / 组末拼写共用）。
 *
 * 草稿必须留在输入框所在的叶子组件里：放到会话 hook（`ReaderApp` 根部）会让
 * 每次按键都重渲染整个阅读页。需要「底部检查按钮」也能读到当前值时，
 * 传一个 `published` ref：按钮读 ref，不把草稿抬成状态。
 *
 * `resetKey` 变（换卡 / 切拼写模式）时清空草稿与 ref。
 */
export function useSpellingDraft(resetKey: string, published?: MutableRefObject<string>) {
  const [draft, setDraft] = useState('')

  useEffect(() => {
    setDraft('')
    if (published) published.current = ''
  }, [resetKey, published])

  const change = (value: string) => {
    setDraft(value)
    if (published) published.current = value
  }

  const clear = () => {
    setDraft('')
    if (published) published.current = ''
  }

  return { draft, change, clear }
}
