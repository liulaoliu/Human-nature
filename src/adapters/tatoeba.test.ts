import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadTatoeba, setTatoeba, tatoebaExamples, tatoebaReady } from './tatoeba'

const tsv = [
  'run\tI run every day.\t我每天跑步。',
  'run\tShe runs fast.\t她跑得快。',
  'walk\tWe walk home.\t我们走回家。',
].join('\n')

afterEach(() => {
  setTatoeba(null)
  vi.restoreAllMocks()
})

describe('tatoeba 适配器', () => {
  it('未加载时查不到；注入数据后可查词形/原形', () => {
    expect(tatoebaReady()).toBe(false)
    expect(tatoebaExamples('run')).toEqual([])

    setTatoeba({
      byWord: new Map([['run', [{ en: 'I run.', zh: '我跑。' }]], ['walk', [{ en: 'We walk.', zh: '我们走。' }]]]),
    })
    expect(tatoebaReady()).toBe(true)
    expect(tatoebaExamples('RUN')).toEqual([{ en: 'I run.', zh: '我跑。' }])
    expect(tatoebaExamples('missing', 'walk')).toEqual([{ en: 'We walk.', zh: '我们走。' }])
    expect(tatoebaExamples('missing')).toEqual([])
  })

  it('加载成功：解析 TSV，之后就绪；重复调用不再请求', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, text: async () => tsv })
    vi.stubGlobal('fetch', f)
    await expect(loadTatoeba()).resolves.toBe(true)
    expect(f).toHaveBeenCalledWith('/tatoeba-en.tsv')
    expect(tatoebaReady()).toBe(true)
    expect(tatoebaExamples('run')).toHaveLength(2)
    expect(tatoebaExamples('run', 'walk')).toHaveLength(2)

    await expect(loadTatoeba()).resolves.toBe(true)
    expect(f).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('文件缺失 / 空文件 / 网络异常：返回 false，不置就绪', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, text: async () => 'x' }))
    await expect(loadTatoeba()).resolves.toBe(false)
    expect(tatoebaReady()).toBe(false)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '   ' }))
    await expect(loadTatoeba('/base')).resolves.toBe(false)

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(loadTatoeba()).resolves.toBe(false)
    expect(tatoebaReady()).toBe(false)
    vi.unstubAllGlobals()
  })
})
