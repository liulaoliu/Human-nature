import { afterEach, describe, expect, it, vi } from 'vitest'
import { dictionary, dictionaryReady, loadDictionary, mwldLookupWord, setDictionary } from './dictionary'

const words = [
  'word\tphonetic\tpos\ten\tzh\ttag\tcollins\toxford\tbnc\tfrq',
  'run\trʌn\tv.\tmove fast\t跑\tcet4\t1\t1\t10\t20',
].join('\n')
const forms = 'running\trun'
const near = 'run\tran,runs'

function mockFiles(files: Record<string, string>) {
  return vi.fn(async (url: string) => ({
    ok: true,
    text: async () => files[url] ?? '',
  }))
}

afterEach(() => {
  setDictionary(null)
  vi.restoreAllMocks()
})

describe('dictionary 适配器', () => {
  it('未注入时未就绪；注入后 ready/查词/M-W 查询走注入数据', () => {
    expect(dictionaryReady()).toBe(false)
    expect(dictionary()).toBeNull()
    expect(mwldLookupWord('run')).toBeNull()

    const d = {
      entries: new Map(),
      forms: new Map(),
      near: new Map(),
    }
    setDictionary(d)
    expect(dictionaryReady()).toBe(true)
    expect(dictionary()).toBe(d)
    // 没注入 M-W 时不崩，返回 null
    expect(mwldLookupWord('run')).toBeNull()
  })

  it('加载成功：读四份文件，词条/词形/近形都进内存', async () => {
    const f = mockFiles({
      '/ecdict.tsv': words,
      '/ecdict-forms.tsv': forms,
      '/ecdict-near.tsv': near,
      '/mwld.tsv': '',
    })
    vi.stubGlobal('fetch', f)
    await expect(loadDictionary()).resolves.toBe(true)
    expect(dictionaryReady()).toBe(true)
    expect(dictionary()?.entries.get('run')).toMatchObject({ phonetic: 'rʌn', pos: 'v.', zh: '跑' })
    expect(dictionary()?.forms.get('running')).toBe('run')
    expect(dictionary()?.near.get('run')).toEqual(['ran', 'runs'])

    // 已加载：不再请求
    await expect(loadDictionary()).resolves.toBe(true)
    expect(f).toHaveBeenCalledTimes(4)
    vi.unstubAllGlobals()
  })

  it('主词表缺失（404）/ 网络异常：返回 false，保持未就绪', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, text: async () => '' }))
    await expect(loadDictionary()).resolves.toBe(false)
    expect(dictionaryReady()).toBe(false)

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(loadDictionary('/base')).resolves.toBe(false)
    expect(dictionaryReady()).toBe(false)
    vi.unstubAllGlobals()
  })
})
