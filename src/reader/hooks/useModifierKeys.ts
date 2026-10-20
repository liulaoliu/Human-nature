import { useEffect, useState } from 'react'
import { useHotkeys } from '../useHotkeys'

/**
 * 跟踪 Ctrl / ⌘ 与 Alt 是否**按住**。
 *
 * 选词逻辑靠它切换「整句 / 按词吸附 / 选词组」：按下时吸附，松开时按整句。
 * 从 `ReaderApp` 抽出来的原因：keydown 走全局分发器（`useHotkeys`），
 * keyup / blur 得自己收尾（切窗口时收不到 keyup，不清理就会一直当按住），
 * 这套「按下 / 松开 / 失焦」三件套跟页面组装没关系。
 */
export function useModifierKeys(): { ctrlHeld: boolean; altHeld: boolean } {
  const [ctrlHeld, setCtrlHeld] = useState(false)
  const [altHeld, setAltHeld] = useState(false)

  useHotkeys(
    (e) => {
      if (e.key === 'Control' || e.key === 'Meta') setCtrlHeld(true)
      if (e.key === 'Alt') setAltHeld(true)
    },
    true,
    10,
  )

  useEffect(() => {
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') setCtrlHeld(false)
      if (e.key === 'Alt') setAltHeld(false)
    }
    // 切窗口/点别处时不一定收得到 keyup，失焦必须一起清
    const blur = () => {
      setCtrlHeld(false)
      setAltHeld(false)
    }
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  return { ctrlHeld, altHeld }
}
