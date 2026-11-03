import { useCallback, useState } from 'react'

/**
 * 「复制提示词 → 展开粘贴框 → 应用成功 → 收起」的共用交互。
 *
 * 本句仿写 / 语言点造句 / 错因订正 / 仿写考试都走这一份状态：
 * - copy：用户主动点「复制批改/出题提示词」，先展开再复制；
 * - auto：AI 直连按钮；只有没配 AI、退化成复制提示词（'copied'）时才展开；
 * - apply：应用结果；成功才清空并收起，失败保持展开和输入。
 */
export function useGoldenPasteBox() {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')

  const copy = useCallback((run: () => void) => {
    setOpen(true)
    run()
  }, [])

  const auto = useCallback(async (run: () => Promise<string>) => {
    if ((await run()) === 'copied') setOpen(true)
  }, [])

  const apply = useCallback(
    (run: (text: string) => boolean) => {
      if (!run(text)) return false
      setText('')
      setOpen(false)
      return true
    },
    [text],
  )

  return { open, setOpen, text, setText, copy, auto, apply }
}
