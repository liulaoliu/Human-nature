import { describe, it, expect } from 'vitest'
import { pickAudioFile, supportsAudioPicker } from './audioPick'

describe('audioPick（无 DOM 环境安全降级）', () => {
  it('node 下不支持 FS API、pick 返回 null', async () => {
    expect(supportsAudioPicker()).toBe(false)
    expect(await pickAudioFile()).toBeNull()
  })
})
